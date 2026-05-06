// BI_BOOT_FIX_v63_INDEX — first line BEFORE imports. Anything that
// throws during import after this still leaves a record proving the
// process started. If this line never appears in Azure logs, Azure
// is not running this file at all (check startup-command).

// eslint-disable-next-line no-console
console.log(JSON.stringify({
  level: "info",
  msg: "[BI_BOOT_FIX_v63] node entered dist/index.js",
  ts: new Date().toISOString(),
  build: process.env.BUILD_TAG || "unknown",
  sha: (process.env.COMMIT_SHA || "unknown").slice(0, 8),
  node: process.version,
  pid: process.pid,
  cwd: process.cwd(),
  port_env: process.env.PORT || "(unset, default 8080)",
}));

import app, { bootstrap } from "./server";
import { env } from "./platform/env";
import { logger } from "./platform/logger";
import { pool } from "./db";

// eslint-disable-next-line no-console
console.log("BI process start", new Date().toISOString());
logger.info("BI process start");
logger.info("BI init start");

// Fire and forget — bootstrap is internally bounded by a 30s deadline.
bootstrap().catch((err) => {
  logger.error({ err }, "BI DB failed (non-blocking)");
});

const port = Number(env.PORT || "8080");

// eslint-disable-next-line no-console
console.log("Starting BI-Server bootstrap...");

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "BI server running");
  // eslint-disable-next-line no-console
  console.log(`[BI_BOOT_FIX_v63] BI server listening on ${port}`);
  // eslint-disable-next-line no-console
  console.log("BI-Server HTTP server ready");
});

// Heartbeat so Azure's log stream proves the process is alive even
// when no requests are coming in.
const heartbeat = setInterval(() => {
  logger.info({ uptime_s: Math.round(process.uptime()) }, "BI heartbeat");
}, 60_000);
heartbeat.unref();

function shutdown(signal: string) {
  logger.info({ signal }, "BI shutdown initiated");
  clearInterval(heartbeat);
  server.close(() => {
    logger.info("BI HTTP listener closed");
    pool.end()
      .then(() => logger.info("BI pg pool drained"))
      .catch((err) => logger.error({ err }, "BI pg pool drain error"))
      .finally(() => process.exit(0));
  });
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
