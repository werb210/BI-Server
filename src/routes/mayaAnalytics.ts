import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.get("/maya-analytics", async (_req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*) FROM maya_leads`);

    const today = await pool.query(`
      SELECT COUNT(*)
      FROM maya_leads
      WHERE created_at >= CURRENT_DATE
    `);

    const byReferral = await pool.query(`
      SELECT referral_code, COUNT(*) AS count
      FROM maya_leads
      GROUP BY referral_code
      ORDER BY COUNT(*) DESC
    `);

    const bySource = await pool.query(`
      SELECT utm_source, COUNT(*) AS count
      FROM maya_leads
      GROUP BY utm_source
      ORDER BY COUNT(*) DESC
    `);

    const crmSuccess = await pool.query(`
      SELECT
        SUM(CASE WHEN crm_status='sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN crm_status='failed' THEN 1 ELSE 0 END) AS failed
      FROM maya_leads
    `);

    return res.json({
      total: Number(total.rows[0].count),
      today: Number(today.rows[0].count),
      referralBreakdown: byReferral.rows,
      sourceBreakdown: bySource.rows,
      crmStatus: {
        sent: Number(crmSuccess.rows[0].sent ?? 0),
        failed: Number(crmSuccess.rows[0].failed ?? 0)
      }
    });
  } catch (err) {
    console.error("Maya analytics error:", err);
    return res.status(500).json({ error: "Analytics failure" });
  }
});

export default router;
