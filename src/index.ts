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
  JWT_SECRET = "dev_secret"
} = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
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

/* ================= POLICY LIST ================= */

app.get("/bi/policies", auth, async (req: any, res) => {
  const { role, email } = req.user;

  if (role === "admin" || role === "lender") {
    const data = await pool.query(`
      SELECT p.*, a.business_name, a.annual_premium
      FROM bi_policies p
      JOIN bi_applications a ON p.application_id = a.id
      ORDER BY p.created_at DESC
    `);
    return res.json(data.rows);
  }

  if (role === "referrer") {
    const data = await pool.query(`
      SELECT p.*, a.business_name, a.annual_premium
      FROM bi_policies p
      JOIN bi_applications a ON p.application_id = a.id
      WHERE a.referrer_email = $1
      ORDER BY p.created_at DESC
    `, [email]);

    return res.json(data.rows);
  }

  res.status(403).json({ error: "Unauthorized" });
});

/* ================= SINGLE POLICY ================= */

app.get("/bi/policies/:id", auth, async (req: any, res) => {
  const { id } = req.params;

  const data = await pool.query(`
    SELECT p.*, a.business_name, a.annual_premium
    FROM bi_policies p
    JOIN bi_applications a ON p.application_id = a.id
    WHERE p.id = $1
  `, [id]);

  if (!data.rows.length)
    return res.status(404).json({ error: "Not found" });

  const commissions = await pool.query(`
    SELECT * FROM bi_commissions
    WHERE policy_id = $1
    ORDER BY year_number ASC
  `, [id]);

  res.json({
    ...data.rows[0],
    commissions: commissions.rows
  });
});

/* ================= COMMISSION AGING ================= */

app.get("/bi/admin/commission-aging", auth, requireRole("admin"), async (req, res) => {
  const data = await pool.query(`
    SELECT
      SUM(CASE WHEN payout_status='pending' AND NOW() - created_at < INTERVAL '30 days'
        THEN commission_amount ELSE 0 END) as current,
      SUM(CASE WHEN payout_status='pending' AND NOW() - created_at >= INTERVAL '30 days'
        AND NOW() - created_at < INTERVAL '60 days'
        THEN commission_amount ELSE 0 END) as over_30,
      SUM(CASE WHEN payout_status='pending' AND NOW() - created_at >= INTERVAL '60 days'
        AND NOW() - created_at < INTERVAL '90 days'
        THEN commission_amount ELSE 0 END) as over_60,
      SUM(CASE WHEN payout_status='pending' AND NOW() - created_at >= INTERVAL '90 days'
        THEN commission_amount ELSE 0 END) as over_90
    FROM bi_commissions
  `);

  res.json(data.rows[0]);
});

/* ================= DASHBOARD METRICS ================= */

app.get("/bi/admin/metrics", auth, requireRole("admin"), async (req, res) => {
  const active = await pool.query(`
    SELECT COUNT(*) FROM bi_policies WHERE status='Active'
  `);

  const cancelled = await pool.query(`
    SELECT COUNT(*) FROM bi_policies WHERE status='Cancelled'
  `);

  const totalPremium = await pool.query(`
    SELECT SUM(annual_premium) FROM bi_applications
  `);

  const totalCommission = await pool.query(`
    SELECT SUM(commission_amount) FROM bi_commissions
  `);

  const churnRate =
    parseInt(cancelled.rows[0].count) /
    (parseInt(active.rows[0].count) +
      parseInt(cancelled.rows[0].count) || 1);

  res.json({
    activePolicies: active.rows[0].count,
    cancelledPolicies: cancelled.rows[0].count,
    churnRate,
    totalPremium: totalPremium.rows[0].sum || 0,
    totalCommission: totalCommission.rows[0].sum || 0
  });
});

/* ================= REFERRER PERFORMANCE ================= */

app.get("/bi/admin/referrer-performance", auth, requireRole("admin"), async (req, res) => {
  const data = await pool.query(`
    SELECT referrer_email,
           SUM(commission_amount) as total_commission,
           COUNT(*) as total_policies
    FROM bi_commissions
    GROUP BY referrer_email
    ORDER BY total_commission DESC
  `);

  res.json(data.rows);
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`BI Server running on port ${PORT}`);
});
