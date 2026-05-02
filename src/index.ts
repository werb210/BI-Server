// BI_BOOT_FIX_v61 — boot fingerprint + heartbeat + fast DB probe.
// Why every line:
// - First console.log fires before pino is wired so an Azure log stream that
//   is silent for >30s definitely indicates the process never started.
// - Build fingerprint (BUILD_TAG + commit short sha) lets us confirm at a
//   glance which version is running. The 51-min silence on 2026-05-02 was
//   actually an old binary, and we had no way to tell from the logs.
// - Heartbeat every 60s prevents Azure App Service from showing
//   "No new trace in past N min(s)" on a healthy idle box. Worth the noise.
// - SIGTERM / SIGINT handlers drain pg.Pool and wait for HTTP close before
//   exit so in-flight transactions aren't killed mid-flight on deploy.
import app, { bootstrap } from "./server";
import { env } from "./platform/env";
import { logger } from "./platform/logger";
import { pool } from "./db";

const BUILD_TAG = process.env.BUILD_TAG || "v61-local";
const COMMIT_SHA = (process.env.COMMIT_SHA || "unknown").slice(0, 8);
const BOOT_AT = new Date().toISOString();

// eslint-disable-next-line no-console
console.log(`BI process start build=${BUILD_TAG} sha=${COMMIT_SHA} at=${BOOT_AT}`);
logger.info({ build: BUILD_TAG, sha: COMMIT_SHA, bootAt: BOOT_AT }, "BI process start");

bootstrap().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, "BI bootstrap rejected (non-blocking)");
});

const port = Number(env.PORT || "8080");
const server = app.listen(port, () => {
  logger.info({ port, build: BUILD_TAG, sha: COMMIT_SHA }, "BI server running");
  // eslint-disable-next-line no-console
  console.log(`BI server listening on ${port} (build=${BUILD_TAG} sha=${COMMIT_SHA})`);
});

// Heartbeat — emit a single line every 60s so the Azure log stream never
// shows "No new trace in past N min(s)" on a healthy idle process.
const heartbeat = setInterval(() => {
  logger.info({ build: BUILD_TAG, sha: COMMIT_SHA, uptimeSec: Math.round(process.uptime()) }, "BI heartbeat");
}, 60_000);
heartbeat.unref();

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "BI shutdown initiated");
  clearInterval(heartbeat);
  server.close(() => {
    logger.info("BI HTTP listener closed");
    pool.end()
      .then(() => logger.info("BI pg pool drained"))
      .catch((err) => logger.error({ err }, "BI pg pool drain error"))
      .finally(() => process.exit(0));
  });
  // Hard exit after 10s so a stuck listener doesn't block deploy.
  setTimeout(() => {
    logger.warn("BI shutdown hard-exit after 10s");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : reason }, "BI unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "BI uncaughtException");
});
