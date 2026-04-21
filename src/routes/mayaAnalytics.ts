import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import sgMail from "@sendgrid/mail";
import crypto from "crypto";
import { env } from "../platform/env";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10
});

function authenticateAdmin(
  req: Request & { admin?: { role?: string; email?: string } },
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { role?: string; email?: string };
    req.admin = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(roles: string[]) {
  return (req: Request & { admin?: { role?: string } }, res: Response, next: NextFunction) => {
    if (!req.admin?.role || !roles.includes(req.admin.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

router.post("/admin-login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    `SELECT * FROM admin_users WHERE email=$1 AND is_active=true`,
    [email]
  );

  if (result.rows.length === 0) {
    return badRequest(res, "Invalid credentials");
  }

  const user = result.rows[0];

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return badRequest(res, "Account locked");
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

    return badRequest(res, "Invalid credentials");
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

  if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM) {
    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM,
      subject: "Your Admin Login Code",
      html: `<h2>${code}</h2><p>Valid for 10 minutes.</p>`
    });
  }

  return ok(res, { step: "otp_required" });
});

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
    return badRequest(res, "Invalid or expired code");
  }

  await pool.query(
    `UPDATE admin_otp_codes SET used=true WHERE id=$1`,
    [result.rows[0].id]
  );

  const user = await pool.query(
    `SELECT role FROM admin_users WHERE email=$1`,
    [email]
  );

  const token = jwt.sign(
    { role: user.rows[0].role, email },
    process.env.JWT_SECRET as string,
    { expiresIn: "8h" }
  );

  return ok(res, { token });
});

router.get(
  "/maya-analytics",
  authenticateAdmin,
  requireRole(["super_admin", "admin", "analyst"]),
  async (_req, res) => {
    const total = await pool.query(`SELECT COUNT(*) FROM maya_leads`);
    const today = await pool.query(
      `SELECT COUNT(*) FROM maya_leads
       WHERE created_at >= CURRENT_DATE`
    );

    return ok(res, {
      total: Number(total.rows[0].count),
      today: Number(today.rows[0].count)
    });
  }
);

router.get(
  "/admin-users",
  authenticateAdmin,
  requireRole(["super_admin"]),
  async (_req, res) => {
    const users = await pool.query(
      `SELECT id,email,role,is_active FROM admin_users`
    );
    return ok(res, users.rows);
  }
);

export default router;
