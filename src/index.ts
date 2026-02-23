import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import sgMail from "@sendgrid/mail";

const app = express();
app.use(cors());
app.use(express.json());

/* ================= ENV ================= */

const {
  PORT = 4002,
  DATABASE_URL,
  JWT_SECRET = "dev_secret",
  PURBECK_WEBHOOK_SECRET = "purbec_secret",
  SENDGRID_API_KEY,
  FROM_EMAIL = "no-reply@boreal.financial"
} = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

const pool = new Pool({ connectionString: DATABASE_URL });

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

/* ================= EMAIL ================= */

async function sendEmail(to: string, subject: string, text: string) {
  if (!SENDGRID_API_KEY) return;

  await sgMail.send({
    to,
    from: FROM_EMAIL,
    subject,
    text
  });
}

/* ================= RENEWAL ENGINE ================= */

async function autoRenewPolicies() {
  const expiring = await pool.query(`
    SELECT p.*, a.annual_premium, a.referrer_email, a.email
    FROM bi_policies p
    JOIN bi_applications a ON p.application_id = a.id
    WHERE p.status='Active'
    AND p.end_date <= NOW()
  `);

  for (const policy of expiring.rows) {
    const yearCount = await pool.query(
      `SELECT COUNT(*) FROM bi_commissions WHERE policy_id=$1`,
      [policy.id]
    );

    const yearNumber = parseInt(yearCount.rows[0].count) + 1;

    const commission = policy.annual_premium * 0.10;

    if (policy.referrer_email) {
      await pool.query(`
        INSERT INTO bi_commissions
        (policy_id, referrer_email, year_number, premium, commission_amount)
        VALUES ($1,$2,$3,$4,$5)
      `, [policy.id, policy.referrer_email, yearNumber, policy.annual_premium, commission]);
    }

    await pool.query(`
      UPDATE bi_policies
      SET start_date = NOW(),
          end_date = NOW() + INTERVAL '1 year'
      WHERE id=$1
    `, [policy.id]);

    await sendEmail(
      policy.email,
      "Policy Renewed",
      "Your Personal Guarantee Insurance policy has been automatically renewed."
    );
  }
}

/* Run daily */
setInterval(autoRenewPolicies, 24 * 60 * 60 * 1000);

/* ================= REMINDER ENGINE ================= */

async function sendRenewalReminders() {
  const reminders = await pool.query(`
    SELECT p.*, a.email
    FROM bi_policies p
    JOIN bi_applications a ON p.application_id = a.id
    WHERE p.status='Active'
    AND p.end_date <= NOW() + INTERVAL '30 days'
  `);

  for (const policy of reminders.rows) {
    await sendEmail(
      policy.email,
      "Policy Expiring Soon",
      "Your Personal Guarantee Insurance policy expires within 30 days."
    );
  }
}

setInterval(sendRenewalReminders, 24 * 60 * 60 * 1000);

/* ================= PURBECK WEBHOOK ================= */

app.post("/bi/webhook/purbec", async (req, res) => {
  if (req.headers["x-purbec-secret"] !== PURBECK_WEBHOOK_SECRET)
    return res.status(403).json({ error: "Unauthorized" });

  const { applicationId, policyNumber, startDate } = req.body;

  const appData = await pool.query(
    `SELECT * FROM bi_applications WHERE id=$1`,
    [applicationId]
  );

  if (!appData.rows.length)
    return res.status(404).json({ error: "Application not found" });

  await pool.query(`
    INSERT INTO bi_policies
    (application_id, policy_number, start_date, end_date)
    VALUES ($1,$2,$3,$4)
  `, [
    applicationId,
    policyNumber,
    startDate,
    new Date(new Date(startDate).setFullYear(new Date(startDate).getFullYear() + 1))
  ]);

  res.json({ activated: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
