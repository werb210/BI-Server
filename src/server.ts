import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";

import { openApiSpec } from "./docs/openapi";
import { pool, runMigrations } from "./db";
import { startPremiumAccrualJob } from "./jobs/premiumAccrualJob";
import { biRateLimiter } from "./middleware/biRateLimit";
import { enforceBIPrefix } from "./middleware/biIsolation";
import biApplicationRoutes from "./routes/biApplicationRoutes";
import biAuthRoutes from "./routes/biAuthRoutes";
import biCommissionRoutes from "./routes/biCommissionRoutes";
import biCrmRoutes from "./routes/biCrmRoutes";
import biDocumentRoutes from "./routes/biDocumentRoutes";
import biEventsRoutes from "./routes/biEvents";
import biPayoutRoutes from "./routes/biPayoutRoutes";
import biPolicyRoutes from "./routes/biPolicyRoutes";
import biReferrerRoutes from "./routes/biReferrerRoutes";
import biReportRoutes from "./routes/biReportRoutes";
import biRoutes from "./routes/biRoutes";
import biUnderwritingRoutes from "./routes/biUnderwritingRoutes";
import chatRoutes from "./routes/chat";
import intakeRoutes from "./routes/intake";
import mayaAnalyticsRoutes from "./routes/mayaAnalytics";
import { requireAuth } from "./platform/auth";
import { env } from "./platform/env";
import { errorHandler } from "./platform/errorHandler";
import healthRoutes from "./platform/healthRoutes";
import { idempotency } from "./platform/idempotency";
import { logger } from "./platform/logger";
import metricsRoutes from "./platform/metricsRoutes";
import { requestId } from "./platform/requestId";
import { httpLogger } from "./utils/httpLogger";

const app = express();

app.use(requestId);
app.use(idempotency);
app.use(express.json({ limit: "10mb" }));
app.use(httpLogger);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});

app.use(limiter);

const spamThrottle = new Map<string, number>();

app.use(helmet());
app.use(compression());
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use("/health", healthRoutes);
app.use(metricsRoutes);

if (env.NODE_ENV !== "production") {
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
    origin: env.BI_WEBSITE_ORIGIN,
    credentials: true
  }),
  biRateLimiter,
  enforceBIPrefix,
  biRoutes,
  biAuthRoutes,
  biApplicationRoutes,
  biEventsRoutes
);

app.use("/api/bi/documents", requireAuth, biDocumentRoutes);
app.use("/api/bi/commissions", requireAuth, biCommissionRoutes);
app.use("/api/bi/crm", requireAuth, biCrmRoutes);
app.use("/api/bi/referrers", requireAuth, biReferrerRoutes);
app.use("/api/bi/reports", requireAuth, biReportRoutes);
app.use("/api/bi/policies", requireAuth, biPolicyRoutes);
app.use("/api/bi/payouts", requireAuth, biPayoutRoutes);
app.use("/api/bi/underwriting", requireAuth, biUnderwritingRoutes);

app.use(errorHandler);

async function bootstrap() {
  await runMigrations(env.DATABASE_URL);

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

  await pool.query("ALTER TABLE pgi_applications ADD COLUMN IF NOT EXISTS data JSONB");
  startPremiumAccrualJob();

  app.listen(Number(env.PORT), () => {
    logger.info(`BI-Server running on port ${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Failed to bootstrap server");
  process.exit(1);
});
