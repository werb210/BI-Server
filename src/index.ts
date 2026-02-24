import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import { z } from "zod";
import mayaAnalytics from "./routes/mayaAnalytics";
import biApplicationRoutes from "./routes/biApplicationRoutes";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

if (!PORT || !DATABASE_URL || !JWT_SECRET) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

app.use("/api", mayaAnalytics);
app.use("/api/bi", biApplicationRoutes);

/* ================= BOOTSTRAP ================= */

async function bootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','lender','referrer')),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_applications (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      business_name TEXT,
      loan_amount NUMERIC,
      loan_type TEXT,
      insured_amount NUMERIC,
      annual_premium NUMERIC,
      referrer_email TEXT,
      lender_email TEXT,
      status TEXT DEFAULT 'submitted',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_policies (
      id SERIAL PRIMARY KEY,
      application_id INTEGER UNIQUE REFERENCES bi_applications(id),
      policy_number TEXT UNIQUE,
      start_date DATE,
      end_date DATE,
      annual_premium NUMERIC,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_commission_ledger (
      id SERIAL PRIMARY KEY,
      policy_id INTEGER REFERENCES bi_policies(id),
      referrer_email TEXT,
      period_start DATE,
      period_end DATE,
      premium NUMERIC,
      commission NUMERIC,
      paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed", err);
  process.exit(1);
});

/* ================= AUTH ================= */

function auth(req: any, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(header.split(" ")[1], JWT_SECRET!);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(role: string) {
  return (req: any, res: any, next: any) => {
    if (req.user.role !== role && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

/* ================= USER CREATE ================= */

app.post("/bi/users/create", auth, requireRole("admin"), async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(["admin", "lender", "referrer"])
  });

  try {
    const data = schema.parse(req.body);
    const hash = await bcrypt.hash(data.password, 10);

    await pool.query(
      `INSERT INTO bi_users (email,password_hash,role)
       VALUES ($1,$2,$3)`,
      [data.email, hash, data.role]
    );

    res.json({ created: true });
  } catch {
    res.status(400).json({ error: "User exists or invalid" });
  }
});

/* ================= LOGIN ================= */

app.post("/bi/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { email, password } = parsed.data;

  const user = await pool.query(`SELECT * FROM bi_users WHERE email=$1`, [email]);

  if (!user.rows.length) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.rows[0].password_hash);

  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ email: user.rows[0].email, role: user.rows[0].role }, JWT_SECRET!, {
    expiresIn: "8h"
  });

  res.json({ token, role: user.rows[0].role });
});

/* ================= APPLICATION ================= */

const appSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  businessName: z.string(),
  loanAmount: z.number(),
  loanType: z.enum(["Secured", "Unsecured"]),
  insuredAmount: z.number(),
  annualPremium: z.number(),
  referrerEmail: z.string().nullable().optional()
});

app.post("/bi/applications", async (req, res) => {
  try {
    const data = appSchema.parse(req.body);

    await pool.query(
      `
      INSERT INTO bi_applications
      (name,email,business_name,loan_amount,loan_type,insured_amount,annual_premium,referrer_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [
        data.name,
        data.email,
        data.businessName,
        data.loanAmount,
        data.loanType,
        data.insuredAmount,
        data.annualPremium,
        data.referrerEmail || null
      ]
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.errors });
  }
});

/* ================= LENDER APPLICATION ================= */

app.post("/bi/lender/applications", auth, requireRole("lender"), async (req: any, res) => {
  try {
    const data = appSchema.parse(req.body);

    await pool.query(
      `
      INSERT INTO bi_applications
      (name,email,business_name,loan_amount,loan_type,insured_amount,annual_premium,lender_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [
        data.name,
        data.email,
        data.businessName,
        data.loanAmount,
        data.loanType,
        data.insuredAmount,
        data.annualPremium,
        req.user.email
      ]
    );

    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Invalid application" });
  }
});

/* ================= ACTIVATE POLICY ================= */

app.post("/bi/policies/activate", auth, requireRole("admin"), async (req, res) => {
  const schema = z.object({
    applicationId: z.number().int().positive(),
    policyNumber: z.string().min(1),
    startDate: z.string().date()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors });
  }

  const { applicationId, policyNumber, startDate } = parsed.data;

  const existing = await pool.query(`SELECT * FROM bi_policies WHERE application_id=$1`, [applicationId]);

  if (existing.rows.length) {
    return res.status(400).json({ error: "Policy already activated" });
  }

  const appData = await pool.query(`SELECT * FROM bi_applications WHERE id=$1`, [applicationId]);

  if (!appData.rows.length) {
    return res.status(404).json({ error: "Application not found" });
  }

  const annualPremium = parseFloat(appData.rows[0].annual_premium);
  const commission = annualPremium * 0.1;
  const referrer = appData.rows[0].referrer_email;

  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const policy = await pool.query(
    `
    INSERT INTO bi_policies
    (application_id,policy_number,start_date,end_date,annual_premium)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
  `,
    [applicationId, policyNumber, startDate, endDate, annualPremium]
  );

  if (referrer) {
    await pool.query(
      `
      INSERT INTO bi_commission_ledger
      (policy_id,referrer_email,period_start,period_end,premium,commission)
      VALUES ($1,$2,$3,$4,$5,$6)
    `,
      [policy.rows[0].id, referrer, startDate, endDate, annualPremium, commission]
    );
  }

  res.json({ activated: true });
});

/* ================= CANCEL POLICY ================= */

app.post("/bi/policies/:id/cancel", auth, requireRole("admin"), async (req, res) => {
  await pool.query(`UPDATE bi_policies SET status='cancelled' WHERE id=$1`, [req.params.id]);
  res.json({ cancelled: true });
});

/* ================= EXPIRE POLICY ================= */

app.post("/bi/policies/:id/expire", auth, requireRole("admin"), async (req, res) => {
  await pool.query(`UPDATE bi_policies SET status='expired' WHERE id=$1`, [req.params.id]);
  res.json({ expired: true });
});

/* ================= RENEW POLICY ================= */

app.post("/bi/policies/:id/renew", auth, requireRole("admin"), async (req, res) => {
  const policy = await pool.query(`SELECT * FROM bi_policies WHERE id=$1`, [req.params.id]);

  if (!policy.rows.length) {
    return res.status(404).json({ error: "Policy not found" });
  }

  if (policy.rows[0].status === "cancelled") {
    return res.status(400).json({ error: "Cannot renew cancelled policy" });
  }

  const newStart = new Date(policy.rows[0].end_date);
  const newEnd = new Date(newStart);
  newEnd.setFullYear(newEnd.getFullYear() + 1);

  await pool.query(
    `
    UPDATE bi_policies
    SET start_date=$1,end_date=$2,status='active'
    WHERE id=$3
  `,
    [newStart, newEnd, req.params.id]
  );

  const commission = policy.rows[0].annual_premium * 0.1;

  const appData = await pool.query(`SELECT referrer_email FROM bi_applications WHERE id=$1`, [
    policy.rows[0].application_id
  ]);
  const referrerEmail = appData.rows[0]?.referrer_email;

  if (referrerEmail) {
    await pool.query(
      `
      INSERT INTO bi_commission_ledger
      (policy_id,referrer_email,period_start,period_end,premium,commission)
      VALUES ($1,$2,$3,$4,$5,$6)
    `,
      [req.params.id, referrerEmail, newStart, newEnd, policy.rows[0].annual_premium, commission]
    );
  }

  res.json({ renewed: true });
});

/* ================= REFERRER VIEW ================= */

app.get("/bi/referrer/commissions", auth, requireRole("referrer"), async (req: any, res) => {
  const rows = await pool.query(
    `
    SELECT *
    FROM bi_commission_ledger
    WHERE referrer_email=$1
  `,
    [req.user.email]
  );

  res.json(rows.rows);
});

/* ================= ADMIN REPORT ================= */

app.get("/bi/reports/summary", auth, requireRole("admin"), async (_req, res) => {
  const totals = await pool.query(`
    SELECT SUM(premium) as total_premium,
           SUM(commission) as total_commission
    FROM bi_commission_ledger
  `);
  res.json(totals.rows[0]);
});

/* ================= PAY COMMISSION ================= */

app.post("/bi/commission/pay", auth, requireRole("admin"), async (req, res) => {
  await pool.query(
    `
    UPDATE bi_commission_ledger
    SET paid=true
    WHERE referrer_email=$1
  `,
    [req.body.referrer_email]
  );

  res.json({ paid: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on ${PORT}`);
});
