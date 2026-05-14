import "express-async-errors";
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
// BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1
import biApplicationsFromBfRoutes from "./routes/biApplicationsFromBfRoutes";
// BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1
import biDocumentsFromBfRoutes from "./routes/biDocumentsFromBfRoutes";
// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
import biMayaStaffRoutes from "./routes/biMayaStaffRoutes";
// BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1
import biOutreachCrmRoutes from "./routes/biOutreachCrmRoutes";
import biAuthRoutes, { biAppApplicantRoutes } from "./routes/biAuthRoutes";
import biCommissionRoutes from "./routes/biCommissionRoutes";
import biCrmRoutes from "./routes/biCrmRoutes";
// BI_SERVER_BLOCK_v257_STAFF_DIRECTORY_v1
import biStaffRoutes from "./routes/biStaffRoutes";
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
import biApplicantOtpRoutes from "./routes/biApplicantOtpRoutes";
// BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
import biApplicantDocFlowRoutes from "./routes/biApplicantDocFlowRoutes";
import biSmsInboundRoutes from "./routes/biSmsInboundRoutes";
import biCarrierHealthRoutes from "./routes/biCarrierHealthRoutes";
import { startCarrierHealthJob, getCarrierHealth } from "./services/carrierHealthService";
import { startDocReminderJob } from "./services/docReminderService";

import biNotesRoutes from "./routes/biNotesRoutes";
import biApolloRoutes from "./routes/biApolloRoutes";
// BI_PGI_ALIGNMENT_v56
import biAdminLenderRoutes from "./routes/biAdminLenderRoutes";
import biContactFormRoutes from "./routes/biContactFormRoutes";
import biNaicsRoutes from "./routes/biNaicsRoutes";
import biScoreRoutes from "./routes/biScoreRoutes";
import biScrapeRoutes from "./routes/biScrapeRoutes";
import { apiTimeoutGuard } from "./middleware/apiTimeoutGuard";
import { apiErrorBoundary } from "./middleware/apiErrorBoundary";
import biLenderApplicationCreate from "./routes/biLenderApplicationCreate.js";
import biLenderApplicationDetail from "./routes/biLenderApplicationDetail.js";
// BI_SERVER_BLOCK_v268_CLEANUP_v1 — D-3: import removed with the dead mount.
// The biLenderAuthRoutes module is kept in src/routes/ for now; another
// cleanup pass can delete the file if no test still imports it.

const app = express();
// BI_BOOT_FIX_v60 — Azure App Service is behind a reverse proxy. Without
// this, req.ip resolves to the proxy and rate limiting / IP throttling
// collapse all clients into one bucket.
app.set("trust proxy", 1);
app.use(apiTimeoutGuard);

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

// BI_SERVER_BLOCK_v62_CORS_AND_PATCH_ALIGNMENT_v1
// Hardcoded production fallback so an unset CORS_ALLOWED_ORIGINS env var
// doesn't silently brick the entire BI silo. Includes:
//   - staff.boreal.financial          (BF-portal)
//   - client.boreal.financial         (BF-client; future PGI add-on)
//   - boreal.financial / www.*        (BF-website)
//   - delightful-sand-...azurestaticapps.net  (BI-Website production SWA)
//   - localhost dev origins
// CORS_ALLOWED_ORIGINS env var still takes precedence and SHOULD be set;
// this is purely a safety net.
const PRODUCTION_FALLBACK_ORIGINS = [
  "https://staff.boreal.financial",
  "https://client.boreal.financial",
  "https://boreal.financial",
  "https://www.boreal.financial",
  "https://delightful-sand-05a55580f.7.azurestaticapps.net",
  "https://witty-moss-0886d220f.7.azurestaticapps.net", // BI_SERVER_BLOCK_v222_CORS_AZURESTATICAPPS_AND_HEALTH_v1 — current BI-Website SWA host
  // BI_SERVER_BLOCK_v239_CORS_BOREAL_INSURE_v1 — public BI-Website now lives at boreal.insure.
  "https://www.boreal.insure",
  "https://boreal.insure",
];
const DEV_FALLBACK_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
];

const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const corsOrigins = configuredOrigins.length
  ? configuredOrigins
  : env.NODE_ENV === "production"
    ? PRODUCTION_FALLBACK_ORIGINS
    : DEV_FALLBACK_ORIGINS;

if (configuredOrigins.length === 0) {
  logger.warn(
    { fallback_count: corsOrigins.length, env: env.NODE_ENV },
    "CORS_ALLOWED_ORIGINS not set; using hardcoded fallback. Set the env var to override."
  );
}

// BI_SERVER_BLOCK_v222_CORS_AZURESTATICAPPS_AND_HEALTH_v1 — origin matcher accepts the configured list OR
// any *.azurestaticapps.net host (so SWA preview/build URL rotations don't
// silently brick CORS). Server-to-server requests (no Origin header) pass through.
const AZ_SWA_HOST_RE = /^https:\/\/[a-z0-9-]+\.[0-9]+\.azurestaticapps\.net$/i;
const corsOriginSet = new Set(corsOrigins);
const biCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser / same-origin
    if (corsOriginSet.has(origin)) return cb(null, true);
    if (AZ_SWA_HOST_RE.test(origin)) return cb(null, true);
    return cb(new Error(`origin not allowed: ${origin}`));
  },
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
app.use("/health", biCors, healthRoutes); // BI_SERVER_BLOCK_v222_CORS_AZURESTATICAPPS_AND_HEALTH_v1

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
// BI_SERVER_BLOCK_v223_LENDER_CARRIER_FORWARDING_v1 — biLenderApplicationCreate handles POST /api/v1/lender/applications
// with the nested body the OTP-authenticated lender form sends. It MUST be
// mounted before biLenderApiRoutes (whose POST /lender/applications expects a
// flat body and runs pgiScore), otherwise Express resolves to the wrong handler.
app.use(biLenderApplicationCreate);
app.use("/api/v1", biCors, biLenderApiRoutes);
app.use("/api/v1", biCors, biApplicantOtpRoutes);
app.use("/api/v1", biCors, biReferrerRoutes);
app.use("/api/v1", biCors, requireAuth, biScoreRoutes);

// Authenticated BI endpoints — every BI route lives under /api/v1/bi
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, requireAuth, biRoutes);
// BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3 — Removed the duplicate
// biPublicApplicationRoutes mount under /api/v1/bi. It was shadowing
// biApplicationRoutes' staff GET /applications/:id (line 218): both
// routers have a /applications/:something route, Express picks the
// first mounted, and the public handler queried by public_id (6-char
// code) instead of UUID, returning 404 for every staff portal app
// detail load. The public flow is still reachable at its primary
// mount at /api/v1 (line 201).
// BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1 — service-JWT-authed BF→BI handoff.
// Mounted alongside the public flow so it gets the same CORS + rate-limit guards.
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, biApplicationsFromBfRoutes);

// BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1 — service-JWT-authed doc mirror.
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, biDocumentsFromBfRoutes);
// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1 — service-JWT-authed Maya staff query endpoint.
app.use("/api/v1/bi", biCors, biRateLimiter, enforceBIPrefix, biMayaStaffRoutes);
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
// BI_SERVER_BLOCK_v267_CRM_REPORTS_MOUNT_ALIGNMENT_v1
// biCrmRoutes' internal paths already include /crm/* — mounting at
// /api/v1/bi/crm doubled the prefix to /api/v1/bi/crm/crm/*.
// BF-portal calls /api/v1/bi/crm/contacts and friends; mount at /api/v1/bi
// so the absolute URL matches the router's path.
app.use("/api/v1/bi", requireAuth, biCrmRoutes);
// BI_SERVER_BLOCK_v257_STAFF_DIRECTORY_v1
app.use("/api/v1/bi/staff", requireAuth, biStaffRoutes);
// BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — outreach endpoints under /api/v1/bi/crm/outreach/*.
// Router has its own requireAuth so we mount at /api/v1/bi to get clean internal paths.
app.use("/api/v1/bi", biOutreachCrmRoutes);

// BI_SERVER_BLOCK_v268_CLEANUP_v1 — D-1: removed dead mount. The working
// mount at /api/v1 (line 221) handles /referrer/otp/* and friends; the
// mount under /api/v1/bi/referrers produced /api/v1/bi/referrers/referrer/*
// URLs that no client calls.
app.use("/api/v1/bi", requireAuth, biLenderRoutes);
// BI_SERVER_BLOCK_v267_CRM_REPORTS_MOUNT_ALIGNMENT_v1
// Same double-prefix pattern: router has /reports/summary, mount used
// to be /api/v1/bi/reports → effective /api/v1/bi/reports/reports/summary.
// BF-portal calls /api/v1/bi/reports/summary.
app.use("/api/v1/bi", requireAuth, biReportRoutes);
app.use("/api/v1/bi/policies", requireAuth, biPolicyRoutes);
app.use("/api/v1/bi/payouts", requireAuth, biPayoutRoutes);
app.use("/api/v1/bi/underwriting", requireAuth, biUnderwritingRoutes);

// BI_HARDENING_v44 — Quote estimate endpoint is PUBLIC per BI-1 (ruling 7).
// No requireAuth — the calculator must work for unauthenticated visitors.
// BI_SERVER_BLOCK_v268_CLEANUP_v1 — D-2: removed dead mount. The working
// mount at /api/v1 (line 213) handles /quote/calculate; this second
// mount produced /api/v1/bi/quote/quote/calculate — dead.

// BI_V1_FINAL_v47 — lender direct API. Admin endpoints inside require staff auth;
// the public submission endpoint authenticates via X-API-Key header.
app.use("/api/v1/bi", biLenderApiRoutes);
// BI_V1_FINAL_v47 — application-scoped notes (BI silo).
app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
app.use("/api/v1/bi", requireAuth, biApolloRoutes);
// BI_PGI_ALIGNMENT_v56
app.use("/api/v1/bi", requireAuth, biAdminLenderRoutes);
app.use("/api/v1", biContactFormRoutes);  // public — no auth
app.use("/api/v1/bi", biCors, biNaicsRoutes); // public NAICS lookup

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
    startDocReminderJob(); // BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
    logger.info("BI bootstrap migrations + jobs started");
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "BI database initialization failed (non-blocking)",
    );
  }
}

export default app;

// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
app.use(biLenderApplicationDetail);
// BI_SERVER_BLOCK_v263_APPLICANT_DOC_FLOW_MOUNT_FIX_v1
// The router declares its routes as /applicants/... (no /api/v1 prefix).
// BI-Website BASE = ${origin}/api/v1, so the website calls
// /api/v1/applicants/applications/:publicId/defer-docs and
// /api/v1/applicants/me/pending-application. Without the /api/v1 mount
// prefix every call 404s. Adding biCors so cross-origin preflight from
// www.boreal.insure passes (this endpoint is public-facing).
app.use("/api/v1", biCors, biApplicantDocFlowRoutes); // BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
app.use(biSmsInboundRoutes);    // BI_SERVER_BLOCK_v234_OPS_HARDENING_v1
app.use(biCarrierHealthRoutes); // BI_SERVER_BLOCK_v234_OPS_HARDENING_v1
// BI_SERVER_BLOCK_v268_CLEANUP_v1 — D-3: removed dead mount. All four
// endpoints (/lender/otp/start, /verify, /me, /applications/mine) are
// already served by biLenderApiRoutes at /api/v1 (line 219), which wins
// by mount order. This mount never served a request.
app.use(apiErrorBoundary);
