import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";

const router = Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function logEvent(
  event_type: string,
  req: Request
) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (event_type, ip_address, user_agent)
       VALUES ($1, $2, $3)`,
      [
        event_type,
        req.ip,
        req.headers["user-agent"] || "unknown"
      ]
    );
  } catch (err) {
    console.error("Audit log failure:", err);
  }
}

function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logEvent("analytics_access_missing_token", req);
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    jwt.verify(token, process.env.ADMIN_JWT_SECRET!);
    logEvent("analytics_access_success", req);
    next();
  } catch {
    logEvent("analytics_access_invalid_token", req);
    return res.status(403).json({ error: "Invalid token" });
  }
}

router.post("/admin-login", async (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    await logEvent("admin_login_failed", req);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { role: "admin" },
    process.env.ADMIN_JWT_SECRET!,
    { expiresIn: "8h" }
  );

  await logEvent("admin_login_success", req);

  res.json({ token });
});

router.get("/maya-analytics", authenticateAdmin, async (_req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*) FROM maya_leads`);

    const today = await pool.query(
      `SELECT COUNT(*) FROM maya_leads
       WHERE created_at >= CURRENT_DATE`
    );

    const byReferral = await pool.query(
      `SELECT referral_code, COUNT(*) 
       FROM maya_leads
       GROUP BY referral_code
       ORDER BY COUNT(*) DESC`
    );

    const bySource = await pool.query(
      `SELECT utm_source, COUNT(*) 
       FROM maya_leads
       GROUP BY utm_source
       ORDER BY COUNT(*) DESC`
    );

    const crmStatus = await pool.query(
      `SELECT 
         SUM(CASE WHEN crm_status='sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN crm_status='failed' THEN 1 ELSE 0 END) AS failed
       FROM maya_leads`
    );

    res.json({
      total: Number(total.rows[0].count),
      today: Number(today.rows[0].count),
      referralBreakdown: byReferral.rows,
      sourceBreakdown: bySource.rows,
      crmStatus: crmStatus.rows[0]
    });

  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: "Analytics failure" });
  }
});

export default router;
