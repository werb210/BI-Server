import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import sgMail from "@sendgrid/mail";
import crypto from "crypto";

const router = Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5
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

/* ---------------- STEP 1: PASSWORD CHECK ---------------- */

router.post(
  "/admin-login",
  loginLimiter,
  async (req: Request, res: Response) => {
    const { password } = req.body;

    const isValid = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH!
    );

    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `INSERT INTO admin_otp_codes (email, code, expires_at)
       VALUES ($1, $2, $3)`,
      [process.env.ADMIN_EMAIL, code, expires]
    );

    await sgMail.send({
      to: process.env.ADMIN_EMAIL!,
      from: process.env.SENDGRID_FROM!,
      subject: "Your Admin Login Code",
      html: `<p>Your login code is:</p><h2>${code}</h2><p>Valid for 10 minutes.</p>`
    });

    res.json({ step: "otp_required" });
  }
);

/* ---------------- STEP 2: VERIFY OTP ---------------- */

router.post("/admin-verify-otp", async (req: Request, res: Response) => {
  const { code } = req.body;

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

  const token = jwt.sign(
    { role: "admin" },
    process.env.ADMIN_JWT_SECRET!,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

/* ---------------- ANALYTICS ---------------- */

router.get(
  "/maya-analytics",
  authenticateAdmin,
  async (_req, res) => {
    try {
      const total = await pool.query(`SELECT COUNT(*) FROM maya_leads`);
      const today = await pool.query(
        `SELECT COUNT(*) FROM maya_leads
         WHERE created_at >= CURRENT_DATE`
      );

      res.json({
        total: Number(total.rows[0].count),
        today: Number(today.rows[0].count)
      });

    } catch {
      res.status(500).json({ error: "Analytics failure" });
    }
  }
);

export default router;
