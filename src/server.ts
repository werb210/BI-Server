import compression from "compression";
import cors from "cors";
import { startPremiumAccrualJob } from "./jobs/premiumAccrualJob";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { validateEnv } from "./config/validateEnv";
import { ENV } from "./config/env";
import { pool, runMigrations } from "./db";
import { enforceBIPrefix } from "./middleware/biIsolation";
import { biRateLimiter } from "./middleware/biRateLimit";

import biPolicyRoutes from "./routes/biPolicyRoutes";
import biPayoutRoutes from "./routes/biPayoutRoutes";
import biUnderwritingRoutes from "./routes/biUnderwritingRoutes";

import biApplicationRoutes from "./routes/biApplicationRoutes";
import biAuthRoutes from "./routes/biAuthRoutes";
import biCommissionRoutes from "./routes/biCommissionRoutes";
import biCrmRoutes from "./routes/biCrmRoutes";
import biDocumentRoutes from "./routes/biDocumentRoutes";
import biEventsRoutes from "./routes/biEvents";
import biReferrerRoutes from "./routes/biReferrerRoutes";
import biReportRoutes from "./routes/biReportRoutes";
import biRoutes from "./routes/biRoutes";
import chatRoutes from "./routes/chat";
import intakeRoutes from "./routes/intake";
import mayaAnalyticsRoutes from "./routes/mayaAnalytics";

validateEnv();

const app = express();
const spamThrottle = new Map<string, number>();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "10mb" }));

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

app.use(
  "/api/bi",
  cors({
    origin: process.env.BI_WEBSITE_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
  biRateLimiter,
  enforceBIPrefix,
  biRoutes,
  biAuthRoutes,
  biApplicationRoutes,
  biEventsRoutes
);

app.use("/api/bi/documents", biDocumentRoutes);
app.use("/api/bi/commissions", biCommissionRoutes);
app.use("/api/bi/crm", biCrmRoutes);
app.use("/api/bi/referrers", biReferrerRoutes);
app.use("/api/bi/reports", biReportRoutes);
app.use("/api/bi/policies", biPolicyRoutes);
app.use("/api/bi/payouts", biPayoutRoutes);
app.use("/api/bi/underwriting", biUnderwritingRoutes);

app.get("/health", (_, res) => {
  res.status(200).json({ status: "ok" });
});

async function bootstrap() {
  await runMigrations(ENV.DATABASE_URL);

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
  startPremiumAccrualJob();

  app.listen(ENV.PORT, () => {
    console.log(`BI-Server running on port ${ENV.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap server", error);
  process.exit(1);
});
