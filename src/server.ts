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
// BI_APOLLO_SYNC_v54_PHASE2
import { startApolloSyncJob } from "./jobs/apolloSyncJob";
import { biRateLimiter } from "./middleware/biRateLimit";
import { enforceBIPrefix } from "./middleware/biIsolation";
import biApplicationRoutes from "./routes/biApplicationRoutes";
import biPublicApplicationRoutes from "./routes/biPublicApplicationRoutes"; // BI_AUDIT_FIX_v58
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
// BI_V1_FINAL_v47 — lender direct API + bi_notes
import biLenderApiRoutes from "./routes/biLenderApiRoutes";
import biNotesRoutes from "./routes/biNotesRoutes";
import biApolloRoutes from "./routes/biApolloRoutes";
// BI_PGI_ALIGNMENT_v56
import biAdminLenderRoutes from "./routes/biAdminLenderRoutes";
import biContactFormRoutes from "./routes/biContactFormRoutes";
import biScoreRoutes from "./routes/biScoreRoutes";
import biScrapeRoutes from "./routes/biScrapeRoutes";

const app = express();
// BI_BOOT_FIX_v60 — Azure App Service is behind a reverse proxy. Without
// this, req.ip resolves to the proxy and rate limiting / IP throttling
// collapse all clients into one bucket.
app.set("trust proxy", 1);

app.use(requestId);
app.use(idempotency);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  // BI_BOOT_FIX_v60 — Azure health probes are aggressive. Without skipping
  // /health and /metrics they consume the global 100/min budget and Azure's
  // own probes return 429, triggering App Service to mark the instance
  // unhealthy. Real clients also get 429s during health-check storms.
  skip: (req) => req.path === "/health" || req.path === "/" || req.path.startsWith("/metrics"),
});

const spamThrottle = new Map<string, number>();
// BI_BOOT_FIX_v60 — prune entries older than 60s every 60s so the Map can't
// grow unbounded. Was a slow memory leak proportional to unique submitter IPs.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, ts] of spamThrottle) if (ts < cutoff) spamThrottle.delete(k);
}, 60_000).unref();

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

// BI_BOOT_FIX_v60 — log every request, including PGI webhooks (raw body).
// Logger must come before pgiWebhookRoutes so its req.id is available to the
// webhook handler's logs.
app.use(httpLogger);
// Webhook (raw body) — must be before express.json
app.use(pgiWebhookRoutes);
app.use(express.json({ limit: "10mb" }));
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

// Public, unauthenticated BI endpoints — BI_HARD_ISOLATION_v59: must carry biCors.
// /api/v1/otp/{request,verify} live in biAuthRoutes and are called cross-origin
// from the public website + the OTP-gated lender/referrer portals. Without
// biCors the preflight returns no Access-Control-Allow-Origin and Chrome
// blocks every call.
app.use("/api/v1", biCors, chatRoutes);
app.use("/api/v1", biCors, mayaAnalyticsRoutes);
app.use("/api/v1", biCors, intakeRoutes);
app.use("/api/v1", biCors, biAuthRoutes);
app.use("/api/v1", biCors, biPublicApplicationRoutes);
app.use("/api/v1", biCors, biScrapeRoutes);
app.use("/api/v1", biCors, biQuoteRoutes);
app.use("/api/v1", biCors, biLenderApiRoutes);
app.use("/api/v1", biCors, biReferrerRoutes);
app.use("/api/v1", biCors, requireAuth, biScoreRoutes);

// Authenticated BI endpoints — every BI route lives under /api/v1/bi
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biRoutes);
// BI_AUDIT_FIX_v58 — public PGI flow (no auth). Must be mounted BEFORE
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, biPublicApplicationRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biApplicationRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biEventsRoutes);
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biAppApplicantRoutes);
// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — biDocumentRoutes serves both per-
// application document handlers (under /applications/:id/...) AND the
// required-doc catalog (under /required-documents). Mount both places.
app.use("/api/v1/bi/applications", requireAuth, biDocumentRoutes);
app.use("/api/v1/bi", requireAuth, biDocumentRoutes);
app.use("/api/v1/bi/documents", requireAuth, biDocumentRoutes);
app.use("/api/v1/bi/commissions", requireAuth, biCommissionRoutes);
app.use("/api/v1/bi/crm", requireAuth, biCrmRoutes);
app.use("/api/v1/bi/referrers", requireAuth, biReferrerRoutes);
app.use("/api/v1/bi", requireAuth, biLenderRoutes);
app.use("/api/v1/bi/reports", requireAuth, biReportRoutes);
app.use("/api/v1/bi/policies", requireAuth, biPolicyRoutes);
app.use("/api/v1/bi/payouts", requireAuth, biPayoutRoutes);
app.use("/api/v1/bi/underwriting", requireAuth, biUnderwritingRoutes);

// BI_HARDENING_v44 — Quote estimate endpoint is PUBLIC per BI-1 (ruling 7).
// No requireAuth — the calculator must work for unauthenticated visitors.
app.use("/api/v1/bi/quote", biQuoteRoutes);

// BI_V1_FINAL_v47 — lender direct API. Admin endpoints inside require staff auth;
// the public submission endpoint authenticates via X-API-Key header.
app.use("/api/v1/bi", biLenderApiRoutes);
// BI_V1_FINAL_v47 — application-scoped notes (BI silo).
app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
app.use("/api/v1/bi", requireAuth, biApolloRoutes);
// BI_PGI_ALIGNMENT_v56
app.use("/api/v1/bi", requireAuth, biAdminLenderRoutes);
app.use("/api/v1", biContactFormRoutes);  // public — no auth

app.use(errorHandler);

// BI_BOOT_FIX_v60 — outer 30-second hard timeout on the entire bootstrap.
// Previously, if pg.Pool hung on TCP connect (no DATABASE_URL, wrong host,
// firewall block) every step of bootstrap would wait forever, the log stream
// went silent, and Azure showed "No new trace in past N min(s)" for 20+ min.
const BOOTSTRAP_TIMEOUT_MS = 30_000;
function bootstrapDeadline<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("bootstrap deadline exceeded")), BOOTSTRAP_TIMEOUT_MS),
    ),
  ]);
}

export async function bootstrap() {
  logger.info("BI bootstrap start");
  try {
    await bootstrapDeadline(bootstrapInner());
    logger.info("BI bootstrap complete");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "BI bootstrap aborted (non-blocking)");
  }
}

async function bootstrapInner() {
  // BI_BOOT_FIX_v61 — fast DB probe. If the DB isn't reachable in 5s, skip
  // migrations entirely and log loudly. The HTTP server still starts so
  // /health stays answering 200 from healthRoutes (which doesn't touch DB).
  let dbUp = false;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB_PROBE_TIMEOUT_5s")), 5000),
      ),
    ]);
    dbUp = true;
    logger.info("BI DB probe ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "BI DB probe failed — migrations + ad-hoc DDL skipped");
    // eslint-disable-next-line no-console
    console.error("⚠️ BI DB unreachable on boot:", message);
  }

  if (!dbUp) {
    // Skip every step that needs the pool.
    return;
  }

  try {
    await runMigrations(env.DATABASE_URL!);
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
    startApolloSyncJob();
    logger.info("BI bootstrap migrations + jobs started");
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "BI database initialization failed (non-blocking)",
    );
  }
}

export default app;
