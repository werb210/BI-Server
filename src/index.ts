import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

/* ================= ENV VALIDATION ================= */

const requiredEnv = ["DATABASE_URL", "JWT_SECRET"];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`${key} missing`);
    process.exit(1);
  }
});

const PORT = process.env.PORT || 4002;
const DATABASE_URL = process.env.DATABASE_URL!;
const JWT_SECRET = process.env.JWT_SECRET!;
const PURBECK_WEBHOOK_SECRET = process.env.PURBECK_WEBHOOK_SECRET || "";

/* ================= DB ================= */

const pool = new Pool({ connectionString: DATABASE_URL });

/* ================= RATE LIMIT ================= */

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500
  })
);

/* ================= DB BOOTSTRAP ================= */

async function bootstrap() {
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
      commission NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_audit_logs (
      id SERIAL PRIMARY KEY,
      action TEXT,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_idempotency (
      id SERIAL PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      endpoint TEXT,
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
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
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

/* ================= IDEMPOTENCY ================= */

async function checkIdempotency(key: string, endpoint: string) {
  const exists = await pool.query(
    `SELECT id FROM bi_idempotency WHERE idempotency_key=$1`,
    [key]
  );

  if (exists.rows.length) return false;

  await pool.query(
    `INSERT INTO bi_idempotency (idempotency_key, endpoint)
     VALUES ($1,$2)`,
    [key, endpoint]
  );

  return true;
}

/* ================= SCHEMAS ================= */

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

const ActivateSchema = z.object({
  applicationId: z.number(),
  policyNumber: z.string(),
  startDate: z.string()
});

/* ================= LOGIN ================= */

app.post("/bi/auth/login", (req, res) => {
  const { email, role } = req.body;

  const token = jwt.sign(
    { email, role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* ================= APPLICATION ================= */

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
    res.status(400).json({ error: err.errors || "Invalid payload" });
  }
});

/* ================= ACTIVATE POLICY ================= */

app.post("/bi/policies/activate", auth, requireRole("admin"), async (req, res) => {
  const idempotencyKey = req.headers["x-idempotency-key"] as string;
  if (!idempotencyKey)
    return res.status(400).json({ error: "Missing idempotency key" });

  const allowed = await checkIdempotency(idempotencyKey, "activate");
  if (!allowed)
    return res.status(409).json({ error: "Duplicate request" });

  try {
    const data = ActivateSchema.parse(req.body);

    const appData = await pool.query(
      `SELECT * FROM bi_applications WHERE id=$1`,
      [data.applicationId]
    );

    if (!appData.rows.length)
      return res.status(404).json({ error: "Application not found" });

    const annualPremium = parseFloat(appData.rows[0].annual_premium);
    const commission = annualPremium * 0.10;

    await pool.query(`
      INSERT INTO bi_policies
      (application_id,policy_number,start_date,end_date,annual_premium,commission)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      data.applicationId,
      data.policyNumber,
      data.startDate,
      new Date(new Date(data.startDate).setFullYear(new Date(data.startDate).getFullYear() + 1)),
      annualPremium,
      commission
    ]);

    res.json({ activated: true });
  } catch (err: any) {
    res.status(400).json({ error: err.errors || "Invalid payload" });
  }
});

/* ================= LIST POLICIES ================= */

app.get("/bi/policies", auth, async (req: any, res) => {
  const { role, email } = req.user;

  if (role === "admin" || role === "lender") {
    const data = await pool.query(`SELECT * FROM bi_policies`);
    return res.json(data.rows);
  }

  if (role === "referrer") {
    const data = await pool.query(`
      SELECT p.*
      FROM bi_policies p
      JOIN bi_applications a ON p.application_id=a.id
      WHERE a.referrer_email=$1
    `, [email]);

    return res.json(data.rows);
  }

  res.status(403).json({ error: "Unauthorized" });
});

/* ================= WEBHOOK ================= */

app.post("/bi/webhook/purbec", async (req, res) => {
  if (req.headers["x-purbec-secret"] !== PURBECK_WEBHOOK_SECRET)
    return res.status(403).json({ error: "Unauthorized" });

  const idempotencyKey = req.headers["x-idempotency-key"] as string;
  if (!idempotencyKey)
    return res.status(400).json({ error: "Missing idempotency key" });

  const allowed = await checkIdempotency(idempotencyKey, "webhook");
  if (!allowed)
    return res.status(409).json({ error: "Duplicate webhook" });

  await pool.query(`
    INSERT INTO bi_audit_logs (action,payload)
    VALUES ($1,$2)
  `, ["purbec_webhook", req.body]);

  res.json({ received: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
