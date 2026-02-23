import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

const router = Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

/* ---------------- RATE LIMITER ---------------- */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Try again later." }
});

/* ---------------- IP WHITELIST ---------------- */

function ipWhitelist(req: Request, res: Response, next: NextFunction) {
  const whitelist = process.env.ADMIN_IP_WHITELIST;

  if (!whitelist) return next();

  const allowed = whitelist.split(",").map((ip) => ip.trim());
  const clientIp = req.ip || "";

  if (!allowed.includes(clientIp)) {
    return res.status(403).json({ error: "IP not allowed" });
  }

  next();
}

/* ---------------- AUTH ---------------- */

function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    jwt.verify(token, process.env.ADMIN_JWT_SECRET!);
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}

/* ---------------- LOGIN ---------------- */

router.post(
  "/admin-login",
  ipWhitelist,
  loginLimiter,
  async (req: Request, res: Response) => {
    const { password } = req.body;

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { role: "admin" },
      process.env.ADMIN_JWT_SECRET!,
      { expiresIn: "8h" }
    );

    res.json({ token });
  }
);

/* ---------------- ANALYTICS ---------------- */

router.get(
  "/maya-analytics",
  ipWhitelist,
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
