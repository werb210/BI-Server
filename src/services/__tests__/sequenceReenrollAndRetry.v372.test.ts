// BI_SEQ_REENROLL_RESTART_v372 / BI_SEQ_SEND_RETRY_v372 / BI_SERVER_BACKEND_TOKEN_CHECK_v372
// v789 [5]/[37]: the biMarketingRoutes.ts greps are now enroll requests to the
// real router, asserting on the response and the SQL it sends. The
// marketingWorker.ts checks read a file this block did not change and stay.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";
import { backendTokenProblem, MAX_SEND_ATTEMPTS, shouldRetrySend } from "../backendToken";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biMarketingRoutes from "../../routes/biMarketingRoutes";

const root = process.cwd();
const worker = readFileSync(join(root, "src/workers/marketingWorker.ts"), "utf8");

const SEQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

async function enroll(insertAnswer: { rows: unknown[]; rowCount: number }) {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    ["FROM bi_sequences WHERE id = $1", { rows: [{ id: SEQ }], rowCount: 1 }],
    ["SELECT delay_seconds FROM bi_sequence_steps", { rows: [{ delay_seconds: 0 }], rowCount: 1 }],
    ["INSERT INTO bi_sequence_enrollments", insertAnswer],
    ["FROM unnest($2::uuid[])", { rows: [{ id: IDS[2], reason: "already_enrolled" }], rowCount: 1 }],
  ]));
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/marketing", biMarketingRoutes);
  const r = await request(app).post(`/api/v1/bi/marketing/sequences/${SEQ}/enroll`).send({ contact_ids: IDS });
  const [insert] = callsMatching(queryMock, "INSERT INTO bi_sequence_enrollments");
  return { r, insertSql: sqlText(insert?.[0]) };
}

describe("backend token check", () => {
  it("rejects the em dash that broke every email on 2026-09-18", () => {
    expect(backendTokenProblem("abcdefghijkl\u2014xyz")).toMatch(/cannot be sent in a header/);
  });
  it("rejects spaces and a missing token", () => {
    expect(backendTokenProblem("abc def")).not.toBeNull();
    expect(backendTokenProblem("")).toMatch(/not set/);
  });
  it("accepts a normal token", () => {
    expect(backendTokenProblem("a1B2-c3_D4.e5~f6")).toBeNull();
  });
  it("every send path refuses before fetch when the token cannot work", () => {
    expect(worker.match(/if \(TOKEN_PROBLEM\) return \{ ok: false, error: TOKEN_PROBLEM \};/g)?.length).toBe(3);
    expect(worker).toContain(".trim();");
  });
});

describe("failed sends retry instead of skipping ahead", () => {
  it("retries until the step has failed MAX_SEND_ATTEMPTS times", () => {
    expect(MAX_SEND_ATTEMPTS).toBe(3);
    expect(shouldRetrySend(1)).toBe(true);
    expect(shouldRetrySend(2)).toBe(true);
    expect(shouldRetrySend(3)).toBe(false);
  });
  it("email, sms and task failures all go through retryOrAdvance", () => {
    expect(worker.match(/failedSend = true;/g)?.length).toBe(3);
    expect(worker).toContain("if (failedSend) {\n    await retryOrAdvance(enr, step.id);");
  });
  it("counts failures only since the enrollment (re)started", () => {
    expect(worker).toContain("ev.created_at >= e.started_at");
  });
});

describe("re-enrolling a finished contact restarts the sequence", () => {
  it("revives completed and stopped rows, leaves active and paused alone", async () => {
    const { r, insertSql } = await enroll({ rows: [{ fresh: true }], rowCount: 1 });
    expect(r.status).toBe(200);
    expect(insertSql).not.toContain("DO NOTHING");
    const conflict = insertSql.slice(insertSql.indexOf("ON CONFLICT (sequence_id, contact_id) DO UPDATE"));
    expect(conflict.length).toBeGreaterThan(0);
    expect(conflict).toContain("SET status = 'active', current_step = 0, next_step_at = EXCLUDED.next_step_at");
    expect(conflict).toContain("started_at = NOW()");
    expect(conflict).toContain("WHERE bi_sequence_enrollments.status IN ('completed', 'stopped')");
    expect(conflict).not.toMatch(/status IN \([^)]*'(paused|active)'/);
  });
  it("reports how many were restarted", async () => {
    // Two rows written: one brand new (xmax = 0), one restarted; the third was skipped.
    const { r, insertSql } = await enroll({ rows: [{ fresh: true }, { fresh: false }], rowCount: 2 });
    expect(insertSql).toContain("RETURNING (xmax = 0) AS fresh");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ inserted: 2, restarted: 1, skipped: 1, requested: 3 });
    expect(r.body.skips).toEqual([{ contact_id: IDS[2], reason: "already_enrolled" }]);
  });
});
