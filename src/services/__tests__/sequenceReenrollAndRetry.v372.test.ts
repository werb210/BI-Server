// BI_SEQ_REENROLL_RESTART_v372 / BI_SEQ_SEND_RETRY_v372 / BI_SERVER_BACKEND_TOKEN_CHECK_v372
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendTokenProblem, MAX_SEND_ATTEMPTS, shouldRetrySend } from "../backendToken";

const root = process.cwd();
const worker = readFileSync(join(root, "src/workers/marketingWorker.ts"), "utf8");
const route = readFileSync(join(root, "src/routes/biMarketingRoutes.ts"), "utf8");

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
  it("revives completed and stopped rows, leaves active and paused alone", () => {
    expect(route).not.toContain("ON CONFLICT (sequence_id, contact_id) DO NOTHING");
    expect(route).toContain("WHERE bi_sequence_enrollments.status IN ('completed', 'stopped')");
    expect(route).toContain("SET status = 'active', current_step = 0, next_step_at = EXCLUDED.next_step_at");
    expect(route).toContain("started_at = NOW()");
  });
  it("reports how many were restarted", () => {
    expect(route).toContain("RETURNING (xmax = 0) AS fresh");
    expect(route).toContain("{ inserted, restarted, skipped:");
  });
});
