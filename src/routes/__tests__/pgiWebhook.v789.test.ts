// BI_SERVER_v789_PGI_WEBHOOK_TX - behaviour of the PGI webhook: one
// transaction on one client, dedup by id or body hash, forward-only status,
// stale events ignored, side effects only after COMMIT.
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";

const { WEBHOOK_SECRET } = vi.hoisted(() => ({ WEBHOOK_SECRET: String(process.env.JWT_SECRET) }));

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query: (...a: unknown[]) => clientQuery(...a), release }));
vi.mock("../../db", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a), connect: () => connect() },
}));
vi.mock("../../platform/env", () => ({ env: { PGI_WEBHOOK_SECRET: WEBHOOK_SECRET } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const notifyBiApplicant = vi.fn(async () => ({ sent: 1, removed: 0 }));
vi.mock("../../services/push/biPushSender", () => ({ notifyBiApplicant: (...a: unknown[]) => (notifyBiApplicant as any)(...a) }));
const onApplicationApproved = vi.fn(async () => undefined);
vi.mock("../../services/pgiOnApprovedHook", () => ({ onApplicationApproved: (...a: unknown[]) => (onApplicationApproved as any)(...a) }));

import router, { PGI_STATUS_RANK, webhookDedupKey } from "../pgiWebhookRoutes";
import { answerBySql, callsMatching, rejects, sqlText } from "../../__tests__/helpers/answerBySql";

function app() {
  const a = express();
  a.use(router);
  return a;
}
function sign(raw: string) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
}
function post(payload: unknown, opts: { signature?: string } = {}) {
  const raw = JSON.stringify(payload);
  return request(app())
    .post("/api/v1/webhooks/pgi")
    .set("Content-Type", "application/json")
    .set("X-PGI-Signature", opts.signature ?? sign(raw))
    .send(raw);
}

// A tiny stateful fake of the database: the dedup table and one application.
let seen: Set<string>;
let app1: { id: string; status: string };
let timeline: string[];

function statusUpdate(sql: string, params?: unknown[]) {
  // Applies the forward-only guard the way Postgres would.
  const guarded = /ELSE -1 END\)\s*<=\s*\$3/.test(sql);
  const current = PGI_STATUS_RANK[app1.status] ?? -1;
  if (guarded && current > Number(params?.[2])) return { rows: [], rowCount: 0 };
  app1.status = String(params?.[1]);
  return { rows: [{ id: app1.id }], rowCount: 1 };
}

function defaultClientRules() {
  return answerBySql([
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/, (sql: string) => { timeline.push(sql.trim()); return { rows: [], rowCount: 0 }; }],
    ["INSERT INTO bi_webhook_log", (_s: string, p?: unknown[]) => {
      const key = String(p?.[0]);
      if (seen.has(key)) return { rows: [], rowCount: 0 };
      seen.add(key);
      return { rows: [{ id: "log-1" }], rowCount: 1 };
    }],
    [/UPDATE bi_applications\s+SET status = \$2/, statusUpdate],
    [/UPDATE bi_applications\s+SET carrier_last_event/, { rows: [{ id: "app-1" }], rowCount: 1 }],
  ], { rows: [], rowCount: 0 });
}

beforeEach(() => {
  seen = new Set();
  app1 = { id: "app-1", status: "submitted" };
  timeline = [];
  poolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  clientQuery.mockReset().mockImplementation(defaultClientRules());
  release.mockReset();
  connect.mockClear();
  notifyBiApplicant.mockReset().mockImplementation(async () => { timeline.push("push"); return { sent: 1, removed: 0 }; });
  onApplicationApproved.mockReset().mockResolvedValue(undefined);
});

describe("PGI webhook v789", () => {
  it("rejects a bad signature with 401 and touches nothing", async () => {
    const r = await post({ id: "evt-1", event: "application.approved", application_id: "PGI-1" }, { signature: "00".repeat(32) });
    expect(r.status).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it("processes an event in one transaction on one client and releases it", async () => {
    const r = await post({ id: "evt-1", event: "application.approved", application_id: "PGI-1" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(timeline).toEqual(["BEGIN", "COMMIT", "push"]); // push only after COMMIT
    expect(app1.status).toBe("approved");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    // The updates ran on the transaction's client, not on the pool.
    expect(callsMatching(poolQuery, "UPDATE bi_applications")).toHaveLength(0);
  });

  it("dedups a repeated event id: second delivery applies nothing", async () => {
    await post({ id: "evt-dup", event: "application.approved", application_id: "PGI-1" }).expect(200);
    clientQuery.mockClear();
    app1.status = "submitted";
    const r = await post({ id: "evt-dup", event: "application.approved", application_id: "PGI-1" });
    expect(r.body).toEqual({ ok: true, deduped: true });
    expect(app1.status).toBe("submitted");
    expect(callsMatching(clientQuery, "UPDATE bi_applications")).toHaveLength(0);
    expect(timeline.slice(-1)).toEqual(["ROLLBACK"]);
  });

  it("dedups an event with no id by sha256 of the raw body", async () => {
    const evt = { event: "application.information_required", application_id: "PGI-1" };
    const raw = JSON.stringify(evt);
    await post(evt).expect(200);
    const key = String((callsMatching(clientQuery, "INSERT INTO bi_webhook_log")[0]![1] as unknown[])[0]);
    expect(key).toBe(`sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`);
    expect(webhookDedupKey(evt, Buffer.from(raw))).toBe(key);
    const again = await post(evt);
    expect(again.body).toEqual({ ok: true, deduped: true });
    expect(notifyBiApplicant).toHaveBeenCalledTimes(1);
  });

  it("rolls back on a failure, answers 500 without the error text, and records pgi_webhook_failed", async () => {
    clientQuery.mockImplementation(answerBySql([
      [/UPDATE bi_applications\s+SET status = \$2/, rejects(new Error("relation secret_table does not exist"))],
    ], defaultClientRules()));
    const r = await post({ id: "evt-fail", event: "application.approved", application_id: "PGI-1" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret_table");
    expect(r.body.error).toBe("pgi_webhook_failed");
    expect(timeline).toContain("ROLLBACK");
    expect(timeline).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
    expect(notifyBiApplicant).not.toHaveBeenCalled();
    const ev = callsMatching(poolQuery, "INSERT INTO bi_events");
    expect(ev).toHaveLength(1);
    expect(sqlText(ev[0]![0])).toContain("'pgi_webhook_failed'");
    expect(sqlText(ev[0]![0])).toContain("'bi'");
  });

  it("a retry after a rolled-back failure is processed (the dedup row was not committed)", async () => {
    // Model Postgres: the dedup insert is undone by ROLLBACK.
    const pending: string[] = [];
    let failNext = true;
    clientQuery.mockImplementation(answerBySql([
      ["INSERT INTO bi_webhook_log", (_s: string, p?: unknown[]) => { const k = String(p?.[0]); if (seen.has(k)) return { rows: [], rowCount: 0 }; seen.add(k); pending.push(k); return { rows: [{ id: "x" }], rowCount: 1 }; }],
      [/^\s*ROLLBACK\s*$/, () => { for (const k of pending.splice(0)) seen.delete(k); timeline.push("ROLLBACK"); return { rows: [] }; }],
      [/^\s*COMMIT\s*$/, () => { pending.length = 0; timeline.push("COMMIT"); return { rows: [] }; }],
      [/UPDATE bi_applications\s+SET status = \$2/, (s: string, p?: unknown[]) => { if (failNext) { failNext = false; throw new Error("db blip"); } return statusUpdate(s, p); }],
    ], defaultClientRules()));
    const first = await post({ id: "evt-retry", event: "application.approved", application_id: "PGI-1" });
    expect(first.status).toBe(500);
    const second = await post({ id: "evt-retry", event: "application.approved", application_id: "PGI-1" });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });
    expect(app1.status).toBe("approved");
  });

  it("a late application.received cannot move an approved application back", async () => {
    app1.status = "approved";
    const r = await post({ id: "evt-late", event: "application.received", application_id: "PGI-1" });
    expect(r.status).toBe(200);
    expect(app1.status).toBe("approved");
    const upd = callsMatching(clientQuery, /UPDATE bi_applications\s+SET status = \$2/);
    expect(upd).toHaveLength(1);
    expect(sqlText(upd[0]![0])).toMatch(/WHEN 'approved' THEN 6/);
    expect((upd[0]![1] as unknown[])[2]).toBe(PGI_STATUS_RANK.submitted);
  });

  it("a forward move still applies (submitted -> under_review on quote)", async () => {
    const r = await post({ id: "evt-q", event: "application.quoted", application_id: "PGI-1", quote_id: "Q1", annual_premium: "5000" });
    expect(r.status).toBe(200);
    expect(app1.status).toBe("under_review");
    expect(callsMatching(clientQuery, /SET quote_id=\$1/)).toHaveLength(1);
  });

  it("ignores events older than 24 hours with 200 and no database work", async () => {
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const r = await post({ id: "evt-old", event: "application.received", application_id: "PGI-1", timestamp: old });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, ignored: "stale" });
    expect(connect).not.toHaveBeenCalled();
    const recent = await post({ id: "evt-new", event: "application.received", application_id: "PGI-1", occurred_at: Math.floor(Date.now() / 1000) - 60 });
    expect(recent.body).toEqual({ ok: true });
  });

  it("policy.bound: best-effort inserts use savepoints and the approval hook runs after COMMIT", async () => {
    onApplicationApproved.mockImplementation(async () => { timeline.push("hook"); });
    clientQuery.mockImplementation(answerBySql([
      ["INSERT INTO bi_policies", rejects(new Error("policies down"))],
    ], defaultClientRules()));
    const r = await post({ id: "evt-bound", event: "policy.bound", application_id: "PGI-1", policy_id: "POL-1" });
    expect(r.status).toBe(200);
    expect(app1.status).toBe("policy_issued");
    expect(callsMatching(clientQuery, "ROLLBACK TO SAVEPOINT")).toHaveLength(1);
    expect(timeline).toEqual(["BEGIN", "COMMIT", "hook"]);
    expect(onApplicationApproved).toHaveBeenCalledWith("app-1");
  });
});
