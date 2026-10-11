// BI_SERVER_REDACT_AUTH_LOGS_v354 / BI_SERVER_SEQUENCE_SEND_LOGS_v354
// v789 [5]/[37]: the httpLogger half was a grep of src/utils/httpLogger.ts; it
// now sends a request through the real httpLogger middleware and reads the log
// line it wrote. The marketingWorker half reads a file this block did not
// change and stays a source check.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

const lines = vi.hoisted(() => [] as string[]);
vi.mock("../platform/logger", async () => {
  const pino = (await import("pino")).default;
  return { logger: pino({ level: "info" }, { write: (chunk: string) => { lines.push(chunk); } }) };
});

import { httpLogger } from "../utils/httpLogger";

const root = process.cwd();
const worker = readFileSync(join(root, "src/workers/marketingWorker.ts"), "utf8");

async function loggedHeadersFor(headers: Record<string, string>) {
  lines.length = 0;
  const app = express();
  app.use(httpLogger);
  app.get("/api/v1/probe", (_req, res) => res.json({ ok: true }));
  let req = request(app).get("/api/v1/probe");
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  await req.expect(200);
  const entry = lines.map((l) => JSON.parse(l)).find((l) => l.req?.url === "/api/v1/probe");
  expect(entry).toBeDefined();
  return { headers: entry.req.headers as Record<string, string>, raw: lines.join("\n") };
}

describe("request logs never contain credentials", () => {
  it("redacts authorization, cookie and the backend service token", async () => {
    const { headers, raw } = await loggedHeadersFor({
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret-bearer",
      Cookie: "sid=cookie-value-123",
      "X-Backend-Token": "backend-token-456",
      "X-Request-Source": "portal",
    });
    expect(headers.authorization).toBe("[redacted]");
    expect(headers.cookie).toBe("[redacted]");
    expect(headers["x-backend-token"]).toBe("[redacted]");
    expect(headers["x-request-source"]).toBe("portal");
    for (const secret of ["secret-bearer", "cookie-value-123", "backend-token-456"]) expect(raw).not.toContain(secret);
  });

  // v789 deliberate change: x-api-key / x-service-token / x-job-token and any
  // header whose name contains token, key or secret are redacted too.
  it("redacts every token, key and secret header (v789)", async () => {
    const { headers, raw } = await loggedHeadersFor({
      "X-Api-Key": "api-key-1",
      "X-Service-Token": "svc-token-2",
      "X-Job-Token": "job-token-3",
      "X-Webhook-Secret": "hook-secret-4",
      "X-Partner-Key": "partner-key-5",
    });
    for (const name of ["x-api-key", "x-service-token", "x-job-token", "x-webhook-secret", "x-partner-key"]) {
      expect(headers[name], name).toBe("[redacted]");
    }
    for (const secret of ["api-key-1", "svc-token-2", "job-token-3", "hook-secret-4", "partner-key-5"]) expect(raw).not.toContain(secret);
  });
});

describe("sequence sends are visible in the log stream", () => {
  it("logs every recorded outcome, warning on failures", () => {
    const fn = worker.slice(worker.indexOf("async function recordEvent("));
    expect(fn.indexOf('"marketing.worker.send.failed"')).toBeLessThan(fn.indexOf("INSERT INTO bi_sequence_events"));
    expect(worker).toContain("`marketing.worker.send.${eventType}`");
  });
  // v410 - v408 replaced the conditional "marketing.worker.tick.due" line with an
  // unconditional "marketing.worker.tick" heartbeat that also carries the backlog,
  // so a silent log stream no longer hides a dead worker.
  it("logs the claim count and the backlog on every tick", () => {
    expect(worker).toContain('"marketing.worker.tick"');
    expect(worker).toContain("claimed: due.length");
    expect(worker).toContain("dueNow:");
  });
});
