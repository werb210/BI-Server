import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const app = express();
app.use(cors());
app.use(express.json());

/* ================= ENV ================= */

const { PORT = 4002, DATABASE_URL, JWT_SECRET = "dev_secret" } = process.env;

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
  `);
}

void initDB();

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
  const { name, email, businessName, loanAmount, loanType, insuredAmount, annualPremium, referrerEmail } =
    req.body;

  const result = await pool.query(
    `INSERT INTO bi_applications
     (name,email,business_name,loan_amount,loan_type,insured_amount,annual_premium,referrer_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [name, email, businessName, loanAmount, loanType, insuredAmount, annualPremium, referrerEmail]
  );

  res.json({ id: result.rows[0].id });
});

/* ================= POLICY ACTIVATION ================= */
/* Admin or webhook would call this */

app.post("/bi/policies/activate", auth, requireRole("admin"), async (req, res) => {
  const { applicationId, policyNumber, startDate } = req.body;

  const appData = await pool.query(`SELECT * FROM bi_applications WHERE id = $1`, [applicationId]);

  if (!appData.rows.length) return res.status(404).json({ error: "Application not found" });

  const application = appData.rows[0];

  const parsedStartDate = new Date(startDate);
  const endDate = new Date(parsedStartDate);
  endDate.setFullYear(parsedStartDate.getFullYear() + 1);

  const policyResult = await pool.query(
    `INSERT INTO bi_policies
     (application_id, policy_number, start_date, end_date)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [applicationId, policyNumber, startDate, endDate]
  );

  const policyId = policyResult.rows[0].id;

  /* Create year 1 commission */
  const annualPremium = Number(application.annual_premium || 0);
  const commission = annualPremium * 0.1;

  if (application.referrer_email) {
    await pool.query(
      `INSERT INTO bi_commissions
       (policy_id, referrer_email, year_number, premium, commission_amount)
       VALUES ($1,$2,1,$3,$4)`,
      [policyId, application.referrer_email, annualPremium, commission]
    );
  }

  res.json({ success: true, policyId });
});

/* ================= RENEWAL ================= */

app.post("/bi/policies/:id/renew", auth, requireRole("admin"), async (req, res) => {
  const { id } = req.params;

  const policyData = await pool.query(
    `SELECT p.*, a.annual_premium, a.referrer_email
     FROM bi_policies p
     JOIN bi_applications a ON p.application_id = a.id
     WHERE p.id = $1`,
    [id]
  );

  if (!policyData.rows.length) return res.status(404).json({ error: "Policy not found" });

  const policy = policyData.rows[0];

  const yearCount = await pool.query(`SELECT COUNT(*) FROM bi_commissions WHERE policy_id = $1`, [id]);

  const yearNumber = parseInt(yearCount.rows[0].count, 10) + 1;
  const annualPremium = Number(policy.annual_premium || 0);
  const commission = annualPremium * 0.1;

  if (policy.referrer_email) {
    await pool.query(
      `INSERT INTO bi_commissions
       (policy_id, referrer_email, year_number, premium, commission_amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, policy.referrer_email, yearNumber, annualPremium, commission]
    );
  }

  res.json({ renewed: true, yearNumber });
});

/* ================= REFERRER LEDGER ================= */

app.get("/bi/commission/ledger", auth, requireRole("referrer"), async (req: any, res) => {
  const { email } = req.user;

  const data = await pool.query(
    `SELECT * FROM bi_commissions
     WHERE referrer_email = $1
     ORDER BY created_at DESC`,
    [email]
  );

  res.json(data.rows);
});

/* ================= ADMIN DASHBOARD ================= */

app.get("/bi/admin/summary", auth, requireRole("admin"), async (_req, res) => {
  const totalPremium = await pool.query(`SELECT SUM(annual_premium) FROM bi_applications`);

  const totalCommission = await pool.query(`SELECT SUM(commission_amount) FROM bi_commissions`);

  res.json({
    totalPremium: totalPremium.rows[0].sum || 0,
    totalCommission: totalCommission.rows[0].sum || 0
  });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
