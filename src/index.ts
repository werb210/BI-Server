// BI_BOOT_FIX_v60 — explicit lifecycle logging + graceful shutdown.
import app, { bootstrap } from "./server";
import { env } from "./platform/env";
import { logger } from "./platform/logger";
import { pool } from "./db";

// Use console.log for the very first line so it appears even if the pino
// logger transport itself fails to initialize. This is the line that proves
// "the process at least started" in the Azure log stream.
// eslint-disable-next-line no-console
console.log("BI process start", new Date().toISOString());
logger.info("BI process start");
logger.info("BI init start");

// Fire and forget — bootstrap is internally bounded by a 30s deadline.
bootstrap().catch((err) => {
  logger.error({ err }, "BI DB failed (non-blocking)");
});

const port = Number(env.PORT || "8080");

const server = app.listen(port, () => {
  logger.info({ port }, "BI server running");
  // eslint-disable-next-line no-console
  console.log(`BI server listening on ${port}`);
});

// Graceful shutdown: Azure sends SIGTERM during deploys. Without this,
// in-flight DB queries get killed mid-transaction.
function shutdown(signal: string) {
  logger.info({ signal }, "BI shutdown initiated");
  server.close(() => {
    logger.info("BI HTTP listener closed");
    pool.end()
      .then(() => logger.info("BI pg pool drained"))
      .catch((err) => logger.error({ err }, "BI pg pool drain error"))
      .finally(() => process.exit(0));
  });
  // Hard exit after 10s if close() stalls.
  setTimeout(() => {
    logger.warn("BI shutdown hard-exit after 10s");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "BI unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "BI uncaughtException");
});
