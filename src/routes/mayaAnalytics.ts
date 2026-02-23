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
  const { email, password } = req.body;

  const result = await pool.query(
    `SELECT * FROM admin_users WHERE email=$1 AND is_active=true`,
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = result.rows[0];

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(403).json({ error: "Account locked" });
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const attempts = user.failed_attempts + 1;
    let lockedUntil = null;

    if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }

    await pool.query(
      `UPDATE admin_users
       SET failed_attempts=$1, locked_until=$2
       WHERE id=$3`,
      [attempts, lockedUntil, user.id]
    );

    return res.status(401).json({ error: "Invalid credentials" });
  }

  await pool.query(
    `UPDATE admin_users
     SET failed_attempts=0, locked_until=NULL
     WHERE id=$1`,
    [user.id]
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

/* ---------------- OTP VERIFY ---------------- */

router.post("/admin-verify-otp", async (req, res) => {
  const { email, code } = req.body;

  const result = await pool.query(
    `SELECT * FROM admin_otp_codes
     WHERE email=$1 AND code=$2
     AND used=false
     AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, code]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  await pool.query(
    `UPDATE admin_otp_codes SET used=true WHERE id=$1`,
    [result.rows[0].id]
  );

  const token = jwt.sign(
    { role: "admin", email },
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
