import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import sgMail from "@sendgrid/mail";
import crypto from "crypto";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10
});

function getClientMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "unknown"
  };
}

async function sendSecurityAlert(
  subject: string,
  message: string
) {
  await sgMail.send({
    to: process.env.ADMIN_EMAIL!,
    from: process.env.SENDGRID_FROM!,
    subject,
    html: `<p>${message}</p>`
  });
}

function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing token" });

  const token = authHeader.split(" ")[1];

  try {
    jwt.verify(token, process.env.ADMIN_JWT_SECRET!);
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}

/* ---------------- LOGIN STEP 1 ---------------- */

router.post("/admin-login", loginLimiter, async (req, res) => {
  const { password } = req.body;
  const email = process.env.ADMIN_EMAIL!;
  const meta = getClientMeta(req);

  const security = await pool.query(
    `SELECT * FROM admin_login_security WHERE email=$1`,
    [email]
  );

  const record = security.rows[0];

  if (record?.locked_until && new Date(record.locked_until) > new Date()) {
    return res.status(403).json({ error: "Account temporarily locked" });
  }

  const valid = await bcrypt.compare(
    password,
    process.env.ADMIN_PASSWORD_HASH!
  );

  if (!valid) {
    const attempts = (record?.failed_attempts || 0) + 1;

    let lockedUntil = null;

    if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 30 * 60 * 1000);

      await sendSecurityAlert(
        "Admin Account Locked",
        `Account locked due to repeated failures.<br>
        IP: ${meta.ip}<br>
        User-Agent: ${meta.userAgent}`
      );
    }

    await pool.query(
      `
      INSERT INTO admin_login_security (email, failed_attempts, locked_until)
      VALUES ($1,$2,$3)
      ON CONFLICT (email)
      DO UPDATE SET failed_attempts=$2, locked_until=$3, updated_at=NOW()
      `,
      [email, attempts, lockedUntil]
    );

    await new Promise(r => setTimeout(r, attempts * 1000));

    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Reset on success
  await pool.query(
    `
    INSERT INTO admin_login_security (email, failed_attempts, locked_until)
    VALUES ($1,0,NULL)
    ON CONFLICT (email)
    DO UPDATE SET failed_attempts=0, locked_until=NULL, updated_at=NOW()
    `,
    [email]
  );

  const code = crypto.randomInt(100000, 999999).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    `INSERT INTO admin_otp_codes (email, code, expires_at)
     VALUES ($1,$2,$3)`,
    [email, code, expires]
  );

  await sgMail.send({
    to: email,
    from: process.env.SENDGRID_FROM!,
    subject: "Your Admin Login Code",
    html: `<h2>${code}</h2><p>Valid for 10 minutes.</p>`
  });

  res.json({ step: "otp_required" });
});

/* ---------------- LOGIN STEP 2 ---------------- */

router.post("/admin-verify-otp", async (req, res) => {
  const { code } = req.body;
  const meta = getClientMeta(req);

  const result = await pool.query(
    `SELECT * FROM admin_otp_codes
     WHERE code=$1 AND used=false AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [code]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  await pool.query(
    `UPDATE admin_otp_codes SET used=true WHERE id=$1`,
    [result.rows[0].id]
  );

  await sendSecurityAlert(
    "Admin Login Successful",
    `Admin login successful.<br>
     IP: ${meta.ip}<br>
     User-Agent: ${meta.userAgent}`
  );

  const token = jwt.sign(
    { role: "admin" },
    process.env.ADMIN_JWT_SECRET!,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* ---------------- ANALYTICS ---------------- */

router.get("/maya-analytics", authenticateAdmin, async (_req, res) => {
  const total = await pool.query(`SELECT COUNT(*) FROM maya_leads`);
  const today = await pool.query(
    `SELECT COUNT(*) FROM maya_leads
     WHERE created_at >= CURRENT_DATE`
  );

  res.json({
    total: Number(total.rows[0].count),
    today: Number(today.rows[0].count)
  });
});

export default router;
