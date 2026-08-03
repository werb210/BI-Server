// BI_SENDGRID_WEBHOOK_SUPPRESSION_FIX_v3
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

import webhookRoutes from "../biSendgridWebhookRoutes";

function makeApp() {
  const app = express();
  app.use(webhookRoutes);
  return app;
}

const hardBounce = [{ email: "Dead.Address@example.com", event: "bounce", type: "bounce" }];

describe("BI_SENDGRID_WEBHOOK_SUPPRESSION_FIX_v3", () => {
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  });

  function statements() {
    return queryMock.mock.calls.map((call) => String(call[0]));
  }

  it("no longer relies on a unique constraint that may not exist", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    await request(makeApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(JSON.stringify(hardBounce)).expect(200);
    const suppression = statements().find((sql) => /INSERT INTO bi_suppressions/.test(sql));
    expect(suppression).toBeDefined();
    expect(suppression).not.toMatch(/ON CONFLICT/i);
    expect(suppression).toMatch(/WHERE NOT EXISTS/i);
  });

  it("dedupes on the same predicate the audience query excludes on", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    await request(makeApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(JSON.stringify(hardBounce)).expect(200);
    const suppression = statements().find((sql) => /INSERT INTO bi_suppressions/.test(sql))!;
    expect(suppression).toContain("lower(email) = lower($1)");
    expect(suppression).toContain("channel IN ('email', 'all')");
  });

  it("reports a suppression only when a row was actually written", async () => {
    queryMock.mockResolvedValue({ rowCount: 0 });
    const res = await request(makeApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(JSON.stringify(hardBounce)).expect(200);
    expect(res.body.suppressed).toBe(0);
  });

  it("counts a first-time suppression", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    const res = await request(makeApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(JSON.stringify(hardBounce)).expect(200);
    expect(res.body.suppressed).toBe(1);
  });

  it("still ignores soft bounces", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    await request(makeApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(JSON.stringify([{ email: "full@example.com", event: "bounce", type: "blocked" }])).expect(200);
    expect(statements().some((sql) => /INSERT INTO bi_suppressions/.test(sql))).toBe(false);
  });

  it("creates the event ledger table the webhook writes to", () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/2026_08_03_bi_marketing_send_events_v3.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bi_marketing_send_events");
    for (const col of ["job_id", "contact_id", "email", "event_type", "detail"]) expect(sql).toContain(col);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it("no longer discards a ledger failure without a word", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/biSendgridWebhookRoutes.ts"), "utf8");
    expect(source).not.toContain(".catch(() => undefined)");
    expect(source).toContain("event ledger insert failed");
  });
});
