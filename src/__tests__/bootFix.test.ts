// BI_BOOT_FIX_v60 — pin the boot-path invariants so future edits don't
// regress us back to silent 20-minute "boots".
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("BI_BOOT_FIX_v60 boot-path invariants", () => {
  it("pg.Pool sets connectionTimeoutMillis", () => {
    const src = read("db/index.ts");
    expect(src).toMatch(/connectionTimeoutMillis:\s*10_?000/); // BI_SERVER_BLOCK_v355 — code uses 10_000
    expect(src).toMatch(/idleTimeoutMillis:\s*300_?000/); // BI_SERVER_ONE_POOL_v718 — 5 min (was 30_000)
  });

  it("pg.Pool has an error handler so dropped clients don't crash the process", () => {
    expect(read("db/index.ts")).toMatch(/pool\.on\("error"/);
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

// v789: the server.ts invariants below were source-text assertions; they now
// exercise the app itself.
const dbQuery = vi.fn(async () => ({ rows: [] as unknown[] }));
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => dbQuery(...(a as [])),
    connect: async () => ({ query: (...a: unknown[]) => dbQuery(...(a as [])), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

describe("BI_BOOT_FIX_v60 server behaviour", () => {
  afterEach(() => {
    vi.useRealTimers();
    dbQuery.mockReset();
    dbQuery.mockImplementation(async () => ({ rows: [] }));
  });

  it("server.ts enables trust proxy", async () => {
    const { default: app } = await import("../server");
    expect(app.get("trust proxy")).toBe(1);
  });

  it("global rate limiter skips /health and /metrics", async () => {
    const { default: app } = await import("../server");
    const statuses = new Set<number>();
    for (let i = 0; i < 620; i += 1) {
      statuses.add((await request(app).get(i % 2 ? "/health" : "/metrics").set("X-Forwarded-For", "198.51.100.9")).status);
    }
    expect(statuses.has(429)).toBe(false);
  });

  it("bootstrap logs a start line and gives up after the 30s deadline", async () => {
    vi.useFakeTimers();
    const { bootstrap } = await import("../server");
    const { logger } = await import("../platform/logger");
    const info = vi.spyOn(logger, "info");
    const error = vi.spyOn(logger, "error");
    // DB probe answers, then every later statement hangs forever.
    dbQuery.mockImplementation(((sql: string) => (/^SELECT 1$/.test(String(sql)) ? Promise.resolve({ rows: [] }) : new Promise(() => undefined))) as any);
    const done = bootstrap();
    expect(info).toHaveBeenCalledWith("BI bootstrap start");
    await vi.advanceTimersByTimeAsync(30_001);
    await done;
    expect(error.mock.calls.some((c) => JSON.stringify(c).includes("bootstrap deadline exceeded"))).toBe(true);
  });

  it("httpLogger is mounted before pgiWebhookRoutes", async () => {
    const { default: app } = await import("../server");
    const stack: Array<{ name: string; handle: any }> = (app as any)._router.stack;
    // pino-http's middleware carries its logger on .logger
    const idxLogger = stack.findIndex((l) => typeof l.handle?.logger?.info === "function");
    const idxWebhook = stack.findIndex((l) => l.name === "router" && l.handle.stack?.some((r: any) => r.route?.path === "/api/v1/webhooks/pgi"));
    expect(idxLogger).toBeGreaterThan(-1);
    expect(idxWebhook).toBeGreaterThan(-1);
    expect(idxLogger).toBeLessThan(idxWebhook);
  });

  it("the /pgi-intake spam throttle refuses a repeat within 5 seconds", async () => {
    const { default: app } = await import("../server");
    const send = () => request(app).post("/api/v1/pgi-intake").set("X-Forwarded-For", "198.51.100.10").send({ email: "a@b.co" });
    await send();
    const second = await send();
    expect(second.status).toBe(400);
    expect(JSON.stringify(second.body)).toContain("Too many submissions");
  });
});
