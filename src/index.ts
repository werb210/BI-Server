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
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL || !JWT_SECRET) {
  console.error("Missing DATABASE_URL or JWT_SECRET");
  process.exit(1);
}

const jwtSecret = JWT_SECRET;

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
    req.user = jwt.verify(header.split(" ")[1], jwtSecret);
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
    jwtSecret,
    { expiresIn: "8h" }
  );

  res.json({ token, role: user.rows[0].role });
});

/* ================= APPLICATION SUBMIT ================= */

const ApplicationSchema = z.object({
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
      data.referrerEmail || null
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

  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const policy = await pool.query(`
    INSERT INTO bi_policies
    (application_id,policy_number,start_date,end_date,annual_premium)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
  `, [
    applicationId,
    policyNumber,
    startDate,
    endDate,
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
      startDate,
      endDate,
      annualPremium,
      commission
    ]);
  }

  res.json({ activated: true });
});

/* ================= RENEW POLICY ================= */

app.post("/bi/policies/:id/renew", auth, requireRole("admin"), async (req, res) => {
  const { id } = req.params;

  const policy = await pool.query(
    `SELECT * FROM bi_policies WHERE id=$1`,
    [id]
  );

  if (!policy.rows.length)
    return res.status(404).json({ error: "Policy not found" });

  const newStart = new Date(policy.rows[0].end_date);
  const newEnd = new Date(newStart);
  newEnd.setFullYear(newEnd.getFullYear() + 1);

  await pool.query(`
    UPDATE bi_policies
    SET start_date=$1,end_date=$2
    WHERE id=$3
  `, [newStart, newEnd, id]);

  const commission = policy.rows[0].annual_premium * 0.10;

  await pool.query(`
    INSERT INTO bi_commission_ledger
    (policy_id,referrer_email,period_start,period_end,premium,commission)
    SELECT id,referrer_email,$1,$2,annual_premium,$3
    FROM bi_policies
    WHERE id=$4
  `, [newStart, newEnd, commission, id]);

  res.json({ renewed: true });
});

/* ================= REPORT SUMMARY ================= */

app.get("/bi/reports/summary", auth, requireRole("admin"), async (req, res) => {
  const totals = await pool.query(`
    SELECT 
      SUM(premium) as total_premium,
      SUM(commission) as total_commission
    FROM bi_commission_ledger
  `);

  res.json(totals.rows[0]);
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on ${PORT}`);
});
