// BI_BOOT_FIX_v60 — pin the boot-path invariants so future edits don't
// regress us back to silent 20-minute "boots".
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("BI_BOOT_FIX_v60 boot-path invariants", () => {
  it("pg.Pool sets connectionTimeoutMillis", () => {
    const src = read("db/index.ts");
    expect(src).toMatch(/connectionTimeoutMillis:\s*5000/);
    expect(src).toMatch(/idleTimeoutMillis:\s*30000/);
  });

  it("pg.Pool has an error handler so dropped clients don't crash the process", () => {
    expect(read("db/index.ts")).toMatch(/pool\.on\("error"/);
  });

  it("server.ts enables trust proxy", () => {
    expect(read("server.ts")).toMatch(/app\.set\("trust proxy",\s*1\)/);
  });

  it("global rate limiter skips /health and /metrics", () => {
    const src = read("server.ts");
    expect(src).toMatch(/skip:\s*\(req\)\s*=>\s*req\.path\s*===\s*"\/health"/);
    expect(src).toMatch(/req\.path\.startsWith\("\/metrics"\)/);
  });

  it("bootstrap is wrapped with a 30s deadline", () => {
    const src = read("server.ts");
    expect(src).toMatch(/BOOTSTRAP_TIMEOUT_MS\s*=\s*30_000/);
    expect(src).toMatch(/bootstrap deadline exceeded/);
  });

  it("bootstrap logs a start line before awaiting the DB", () => {
    expect(read("server.ts")).toMatch(/logger\.info\("BI bootstrap start"\)/);
  });

  it("httpLogger is mounted before pgiWebhookRoutes", () => {
    const src = read("server.ts");
    const idxLogger = src.indexOf("app.use(httpLogger)");
    const idxWebhook = src.indexOf("app.use(pgiWebhookRoutes)");
    expect(idxLogger).toBeGreaterThan(0);
    expect(idxWebhook).toBeGreaterThan(0);
    expect(idxLogger).toBeLessThan(idxWebhook);
  });

  it("spamThrottle has a periodic prune", () => {
    expect(read("server.ts")).toMatch(/spamThrottle\.delete/);
  });

  it("index.ts registers SIGTERM and SIGINT handlers", () => {
    const src = read("index.ts");
    expect(src).toMatch(/process\.on\("SIGTERM"/);
    expect(src).toMatch(/process\.on\("SIGINT"/);
  });

  it("index.ts emits a console.log start line for log-stream visibility", () => {
    expect(read("index.ts")).toMatch(/console\.log\("BI process start"/);
  });

  it("index.ts handles unhandledRejection and uncaughtException", () => {
    const src = read("index.ts");
    expect(src).toMatch(/unhandledRejection/);
    expect(src).toMatch(/uncaughtException/);
  });
});
