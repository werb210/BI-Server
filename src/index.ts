import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4002;
const DATABASE_URL = process.env.DATABASE_URL!;
const JWT_SECRET = process.env.JWT_SECRET!;

if (!DATABASE_URL || !JWT_SECRET) {
  console.error("Missing environment variables");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

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
      status TEXT DEFAULT 'submitted',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_policies (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES bi_applications(id),
      policy_number TEXT,
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

bootstrap();

/* ================= AUTH ================= */

function auth(req: any, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(
      header.split(" ")[1],
      JWT_SECRET
    );
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(role: string) {
  return (req: any, res: any, next: any) => {
    if (req.user.role !== role && req.user.role !== "admin")
      return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/* ================= USER CREATE ================= */

app.post("/bi/users/create", auth, requireRole("admin"), async (req, res) => {
  const { email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);

  try {
    await pool.query(
      `INSERT INTO bi_users (email,password_hash,role)
       VALUES ($1,$2,$3)`,
      [email, hash, role]
    );
    res.json({ created: true });
  } catch {
    res.status(400).json({ error: "User exists" });
  }
});

/* ================= LOGIN ================= */

app.post("/bi/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await pool.query(
    `SELECT * FROM bi_users WHERE email=$1`,
    [email]
  );

  if (!user.rows.length)
    return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(
    password,
    user.rows[0].password_hash
  );

  if (!valid)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { email: user.rows[0].email, role: user.rows[0].role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* ================= APPLICATION ================= */

const ApplicationSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  businessName: z.string(),
  loanAmount: z.number(),
  loanType: z.enum(["Secured", "Unsecured"]),
  insuredAmount: z.number(),
  annualPremium: z.number(),
  referrerEmail: z.string().optional().nullable()
});

app.post("/bi/applications", async (req, res) => {
  try {
    const data = ApplicationSchema.parse(req.body);

    await pool.query(`
      INSERT INTO bi_applications
      (name,email,business_name,loan_amount,loan_type,insured_amount,annual_premium,referrer_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      data.name,
      data.email,
      data.businessName,
      data.loanAmount,
      data.loanType,
      data.insuredAmount,
      data.annualPremium,
      data.referrerEmail
    ]);

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.errors });
  }
});

/* ================= ACTIVATE POLICY ================= */

app.post("/bi/policies/activate", auth, requireRole("admin"), async (req, res) => {
  const { applicationId, policyNumber, startDate } = req.body;

  const appData = await pool.query(
    `SELECT * FROM bi_applications WHERE id=$1`,
    [applicationId]
  );

  if (!appData.rows.length)
    return res.status(404).json({ error: "Application not found" });

  const annualPremium = parseFloat(appData.rows[0].annual_premium);
  const commission = annualPremium * 0.10;
  const referrer = appData.rows[0].referrer_email;

  const policy = await pool.query(`
    INSERT INTO bi_policies
    (application_id,policy_number,start_date,end_date,annual_premium)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
  `, [
    applicationId,
    policyNumber,
    startDate,
    new Date(new Date(startDate).setFullYear(new Date(startDate).getFullYear() + 1)),
    annualPremium
  ]);

  if (referrer) {
    await pool.query(`
      INSERT INTO bi_commission_ledger
      (policy_id,referrer_email,period_start,period_end,premium,commission)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      policy.rows[0].id,
      referrer,
      policy.rows[0].start_date,
      policy.rows[0].end_date,
      annualPremium,
      commission
    ]);
  }

  res.json({ activated: true });
});

/* ================= POLICY LIST ================= */

app.get("/bi/policies", auth, async (req: any, res) => {
  const { role, email } = req.user;

  if (role === "admin" || role === "lender") {
    const policies = await pool.query(
      `SELECT * FROM bi_policies ORDER BY created_at DESC`
    );
    return res.json(policies.rows);
  }

  if (role === "referrer") {
    const policies = await pool.query(`
      SELECT p.*
      FROM bi_policies p
      JOIN bi_commission_ledger c ON p.id=c.policy_id
      WHERE c.referrer_email=$1
    `, [email]);

    return res.json(policies.rows);
  }

  res.status(403).json({ error: "Unauthorized" });
});

/* ================= REPORTING ================= */

app.get("/bi/reports/summary", auth, requireRole("admin"), async (req, res) => {
  const totals = await pool.query(`
    SELECT 
      SUM(premium) as total_premium,
      SUM(commission) as total_commission
    FROM bi_commission_ledger
  `);

  res.json(totals.rows[0]);
});

app.get("/bi/reports/referrers", auth, requireRole("admin"), async (req, res) => {
  const data = await pool.query(`
    SELECT referrer_email,
           SUM(commission) as total_commission,
           SUM(CASE WHEN paid=false THEN commission ELSE 0 END) as unpaid
    FROM bi_commission_ledger
    GROUP BY referrer_email
  `);

  res.json(data.rows);
});

/* ================= PAY COMMISSION ================= */

app.post("/bi/commission/pay", auth, requireRole("admin"), async (req, res) => {
  const { referrer_email } = req.body;

  await pool.query(`
    UPDATE bi_commission_ledger
    SET paid=true
    WHERE referrer_email=$1
  `, [referrer_email]);

  res.json({ paid: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on ${PORT}`);
});
