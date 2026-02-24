import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { ENV } from "./config/env";
import { pool } from "./db";
import intakeRoutes from "./routes/intake";
import chatRoutes from "./routes/chat";
import mayaAnalyticsRoutes from "./routes/mayaAnalytics";
import biRoutes from "./routes/biRoutes";
import biAuthRoutes from "./routes/biAuthRoutes";
import { startPurgeJob } from "./jobs/purgeJob";

const app = express();
const spamThrottle = new Map<string, number>();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(
  cors({
    origin: ENV.CORS_ORIGIN,
    credentials: true
  })
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200
  })
);

if (ENV.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use("/api", (req, res, next) => {
  if (req.path !== "/pgi-intake" || req.method !== "POST") {
    return next();
  }

  const throttleKey = `${req.ip}:${String(req.body?.email ?? "")}`;
  const now = Date.now();
  const lastSeen = spamThrottle.get(throttleKey) ?? 0;

  if (now - lastSeen < 5000) {
    return res.status(429).json({ error: "Too many submissions" });
  }

  spamThrottle.set(throttleKey, now);
  return next();
});

app.use("/api", intakeRoutes);
app.use("/api", chatRoutes);
app.use("/api", mayaAnalyticsRoutes);
app.use("/api", biRoutes);
app.use("/api/bi", biAuthRoutes);

app.get("/health", (_, res) => {
  res.status(200).json({ status: "ok" });
});

async function bootstrap() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_id UUID REFERENCES referrers(id),
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lenders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lender_uploads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lender_id UUID REFERENCES lenders(id),
      filename TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pgi_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE pgi_applications ADD COLUMN IF NOT EXISTS data JSONB`);
}

bootstrap()
  .then(() => {
    startPurgeJob();
    app.listen(ENV.PORT, () => {
      console.log(`BI-Server running on port ${ENV.PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to bootstrap server", error);
    process.exit(1);
  });
