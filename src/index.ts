import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = 4002,
  DATABASE_URL,
  JWT_SECRET = "dev_secret",
  PURBECK_WEBHOOK_SECRET = "purbec_secret"
} = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

/* ================= DB INIT ================= */

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bi_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bi_applications (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      business_name TEXT,
      loan_amount NUMERIC,
      loan_type TEXT,
      insured_amount NUMERIC,
      annual_premium NUMERIC,
      status TEXT DEFAULT 'Submitted',
      referrer_email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_policies (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES bi_applications(id),
      policy_number TEXT,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_commissions (
      id SERIAL PRIMARY KEY,
      policy_id INTEGER REFERENCES bi_policies(id),
      referrer_email TEXT,
      year_number INTEGER,
      premium NUMERIC,
      commission_amount NUMERIC,
      payout_status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bi_audit_logs (
      id SERIAL PRIMARY KEY,
      action TEXT,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

void initDB();

/* ================= AUTH ================= */

function auth(req: any, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "No token" });
  }

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
    if (req.user.role !== role && req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

/* ================= LOGIN ================= */

app.post("/bi/auth/login", async (req, res) => {
  const { email, role } = req.body;

  await pool.query(
    `INSERT INTO bi_users (email, role)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, role]
  );

  const token = jwt.sign({ email, role }, JWT_SECRET, { expiresIn: "8h" });

  res.json({ token });
});

/* ================= APPLICATION ================= */

app.post("/bi/applications", async (req, res) => {
  const result = await pool.query(
    `INSERT INTO bi_applications
     (name,email,business_name,loan_amount,loan_type,insured_amount,annual_premium,referrer_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      req.body.name,
      req.body.email,
      req.body.businessName,
      req.body.loanAmount,
      req.body.loanType,
      req.body.insuredAmount,
      req.body.annualPremium,
      req.body.referrerEmail
    ]
  );

  res.json({ id: result.rows[0].id });
});

/* ================= POLICY ACTIVATE ================= */

async function createCommission(policyId: number, annualPremium: number, referrerEmail: string, year: number) {
  const commission = annualPremium * 0.1;

  await pool.query(
    `INSERT INTO bi_commissions
     (policy_id, referrer_email, year_number, premium, commission_amount)
     VALUES ($1,$2,$3,$4,$5)`,
    [policyId, referrerEmail, year, annualPremium, commission]
  );
}

app.post("/bi/policies/activate", auth, requireRole("admin"), async (req, res) => {
  const { applicationId, policyNumber, startDate } = req.body;

  const appData = await pool.query(`SELECT * FROM bi_applications WHERE id = $1`, [applicationId]);

  if (!appData.rows.length) {
    return res.status(404).json({ error: "Application not found" });
  }

  const application = appData.rows[0];

  const start = new Date(startDate);
  const end = new Date(start);
  end.setFullYear(start.getFullYear() + 1);

  const policy = await pool.query(
    `INSERT INTO bi_policies
     (application_id, policy_number, start_date, end_date)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [applicationId, policyNumber, startDate, end]
  );

  const policyId = policy.rows[0].id;

  if (application.referrer_email) {
    await createCommission(policyId, Number(application.annual_premium), application.referrer_email, 1);
  }

  await pool.query(`INSERT INTO bi_audit_logs (action, payload) VALUES ($1,$2)`, ["policy_activated", req.body]);

  res.json({ policyId });
});

/* ================= RENEW ================= */

app.post("/bi/policies/:id/renew", auth, requireRole("admin"), async (req, res) => {
  const { id } = req.params;

  const data = await pool.query(
    `SELECT p.*, a.annual_premium, a.referrer_email
     FROM bi_policies p
     JOIN bi_applications a ON p.application_id = a.id
     WHERE p.id = $1`,
    [id]
  );

  if (!data.rows.length) {
    return res.status(404).json({ error: "Policy not found" });
  }

  const policy = data.rows[0];

  if (policy.status !== "Active") {
    return res.status(400).json({ error: "Only active policies can be renewed" });
  }

  const yearCount = await pool.query(`SELECT COUNT(*) FROM bi_commissions WHERE policy_id = $1`, [id]);

  const yearNumber = parseInt(yearCount.rows[0].count, 10) + 1;

  if (policy.referrer_email) {
    await createCommission(Number(id), Number(policy.annual_premium), policy.referrer_email, yearNumber);
  }

  await pool.query(`INSERT INTO bi_audit_logs (action, payload) VALUES ($1,$2)`, [
    "policy_renewed",
    { policyId: id, yearNumber }
  ]);

  res.json({ renewed: true, yearNumber });
});

/* ================= CANCEL POLICY ================= */

app.post("/bi/policies/:id/cancel", auth, requireRole("admin"), async (req, res) => {
  const { id } = req.params;

  await pool.query(`UPDATE bi_policies SET status = 'Cancelled' WHERE id = $1`, [id]);

  await pool.query(`INSERT INTO bi_audit_logs (action, payload) VALUES ($1,$2)`, ["policy_cancelled", { policyId: id }]);

  res.json({ cancelled: true });
});

/* ================= MARK COMMISSION PAID ================= */

app.post("/bi/commission/:id/mark-paid", auth, requireRole("admin"), async (req, res) => {
  const { id } = req.params;

  await pool.query(`UPDATE bi_commissions SET payout_status = 'paid' WHERE id = $1`, [id]);

  await pool.query(`INSERT INTO bi_audit_logs (action, payload) VALUES ($1,$2)`, [
    "commission_marked_paid",
    { commissionId: id }
  ]);

  res.json({ markedPaid: true });
});

/* ================= REFERRER LEDGER ================= */

app.get("/bi/commission/ledger", auth, requireRole("referrer"), async (req: any, res) => {
  const { email } = req.user;

  const data = await pool.query(`SELECT * FROM bi_commissions WHERE referrer_email = $1 ORDER BY created_at DESC`, [
    email
  ]);

  res.json(data.rows);
});

/* ================= CSV EXPORT ================= */

app.get("/bi/admin/export", auth, requireRole("admin"), async (_req, res) => {
  const data = await pool.query(`SELECT * FROM bi_commissions ORDER BY created_at DESC`);

  const header = Object.keys(data.rows[0] || {}).join(",");
  const rows = data.rows.map((r) => Object.values(r).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=commissions.csv");
  res.send(`${header}\n${rows}`);
});

/* ================= PURBECK WEBHOOK ================= */

app.post("/bi/webhook/purbec", async (req, res) => {
  if (req.headers["x-purbec-secret"] !== PURBECK_WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  await pool.query(`INSERT INTO bi_audit_logs (action, payload) VALUES ($1,$2)`, ["purbec_webhook", req.body]);

  res.json({ received: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
