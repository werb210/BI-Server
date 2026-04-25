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
import { startPurgeJob } from "./jobs/purgeJob";
import { biRateLimiter } from "./middleware/biRateLimit";
import { enforceBIPrefix } from "./middleware/biIsolation";
import biApplicationRoutes from "./routes/biApplicationRoutes";
import biAuthRoutes, { biAppApplicantRoutes } from "./routes/biAuthRoutes";
import biCommissionRoutes from "./routes/biCommissionRoutes";
import biCrmRoutes from "./routes/biCrmRoutes";
import biDocumentRoutes from "./routes/biDocumentRoutes";
import biEventsRoutes from "./routes/biEvents";
import biLenderRoutes from "./routes/biLenderRoutes";
import biPayoutRoutes from "./routes/biPayoutRoutes";
import biPolicyRoutes from "./routes/biPolicyRoutes";
import biQuoteRoutes from "./routes/biQuoteRoutes";
import biReferrerRoutes from "./routes/biReferrerRoutes";
import biReportRoutes from "./routes/biReportRoutes";
import biRoutes from "./routes/biRoutes";
import biUnderwritingRoutes from "./routes/biUnderwritingRoutes";
import chatRoutes from "./routes/chat";
import intakeRoutes from "./routes/intake";
import mayaAnalyticsRoutes from "./routes/mayaAnalytics";
import pgiWebhookRoutes from "./routes/pgiWebhookRoutes";
import { requireAuth } from "./platform/auth";
import { env } from "./platform/env";
import { errorHandler } from "./platform/errorHandler";
import healthRoutes from "./platform/healthRoutes";
import { idempotency } from "./platform/idempotency";
import { logger } from "./platform/logger";
import metricsRoutes from "./platform/metricsRoutes";
import { requestId } from "./platform/requestId";
import { badRequest } from "./utils/apiResponse";
import { httpLogger } from "./utils/httpLogger";

const app = express();

app.use(requestId);
app.use(idempotency);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});

const spamThrottle = new Map<string, number>();

const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const corsOrigins = configuredOrigins.length
  ? configuredOrigins
  : env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://localhost:3000"];

if (env.NODE_ENV === "production" && corsOrigins.length === 0) {
  logger.error("CORS_ALLOWED_ORIGINS is empty in production; browser requests with credentials will be blocked.");
}

const biCors = cors({
  origin: corsOrigins,
  credentials: true,
});

// Webhook (raw body) — must be before express.json
app.use(pgiWebhookRoutes);
app.use(express.json({ limit: "10mb" }));
app.use(httpLogger);
app.use(limiter);
app.use(helmet());
app.use(compression());
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use("/health", healthRoutes);
app.use(metricsRoutes);
if (env.NODE_ENV !== "production") app.use(morgan("dev"));

// Spam throttle for /pgi-intake
app.use("/api/v1", (req, res, next) => {
  if (req.path !== "/pgi-intake" || req.method !== "POST") {
    return next();
  }

  const throttleKey = `${req.ip}:${String(req.body?.email ?? "")}`;
  const now = Date.now();
  const lastSeen = spamThrottle.get(throttleKey) ?? 0;

  if (now - lastSeen < 5000) {
    return badRequest(res, "Too many submissions");
  }

  spamThrottle.set(throttleKey, now);
  return next();
});

// Public, unauthenticated BI endpoints
app.use("/api/v1", chatRoutes);
app.use("/api/v1", mayaAnalyticsRoutes);
app.use("/api/v1", intakeRoutes);
app.use("/api/v1", biAuthRoutes);

// Authenticated BI endpoints — every BI route lives under /api/v1/bi
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biApplicationRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biEventsRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biAppApplicantRoutes);
app.use("/api/v1/bi/applications", requireAuth, biDocumentRoutes);
app.use("/api/v1/bi/documents", requireAuth, biDocumentRoutes);
app.use("/api/v1/bi/commissions", requireAuth, biCommissionRoutes);
app.use("/api/v1/bi/crm", requireAuth, biCrmRoutes);
app.use("/api/v1/bi/referrers", requireAuth, biReferrerRoutes);
app.use("/api/v1/bi", requireAuth, biLenderRoutes);
app.use("/api/v1/bi/reports", requireAuth, biReportRoutes);
app.use("/api/v1/bi/policies", requireAuth, biPolicyRoutes);
app.use("/api/v1/bi/payouts", requireAuth, biPayoutRoutes);
app.use("/api/v1/bi/underwriting", requireAuth, biUnderwritingRoutes);

// Quote estimate endpoint
app.use("/api/v1/bi/quote", requireAuth, biQuoteRoutes);

app.use(errorHandler);

export async function bootstrap() {
  await Promise.race([
    pool.query("SELECT 1"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 5000))
  ])
    .then(() => {
      logger.info("BI DB connected");
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Unknown DB error";
      console.error("⚠️ BI DB skipped:", message);
    });

  try {
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
    startPurgeJob();
  } catch (error) {
    logger.error({ err: error }, "Database initialization failed (non-blocking)");
  }
}

export default app;
