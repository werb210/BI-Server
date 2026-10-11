// BI_SERVER_BLOCK_v361_CRON_COLUMN_FIX_v1
// BI_SERVER_v789 - rewritten as a behaviour test: runs the reminder tick
// against a mocked database and checks the candidate query it actually issues
// (it used to assert on the source text of biJobs.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => poolQuery(...a),
    connect: async () => ({
      query: async (sql: string) => (/pg_try_advisory_lock/.test(sql) ? { rows: [{ locked: true }] } : { rows: [] }),
      release: () => undefined,
    }),
  },
}));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../platform/env", () => ({ env: {} }));
vi.mock("../../services/smsService", () => ({ sendOutreachSms: vi.fn() }));
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn(async () => ({ channel: "push" })) }));

import { runDocsReminderCronTick } from "../biJobs";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

async function candidateSql(): Promise<string> {
  await runDocsReminderCronTick();
  const calls = callsMatching(poolQuery, "FROM bi_applications a");
  expect(calls).toHaveLength(1);
  return sqlText(calls[0]![0]).replace(/\s+/g, " ");
}

describe("v361 - docs reminder cron column fix", () => {
  beforeEach(() => {
    poolQuery.mockReset().mockImplementation(answerBySql([["FROM bi_applications a", { rows: [] }]]));
  });

  it("query no longer references non-existent a.pipeline_stage column", async () => {
    expect(await candidateSql()).not.toMatch(/a\.pipeline_stage/);
  });
  it("status filter covers created + in_progress + document_review", async () => {
    expect(await candidateSql()).toContain("a.status IN ('created', 'in_progress', 'document_review')");
  });
  it("limits to source='public' (lender + referrer paths auto-submit)", async () => {
    expect(await candidateSql()).toContain("a.source = 'public'");
  });
  it("HAVING COUNT(d.id) = 0 still gates on no-docs-uploaded", async () => {
    expect(await candidateSql()).toContain("HAVING COUNT(d.id) = 0");
  });
  it("updates the reminder counters for each candidate it reminds", async () => {
    poolQuery.mockImplementation(answerBySql([
      ["FROM bi_applications a", { rows: [{ id: "a1", public_id: "BI-1", business_name: "Acme", docs_reminder_count: 2, sms_to: "+15875551234" }] }],
    ]));
    const out = await runDocsReminderCronTick();
    expect(out).toMatchObject({ scanned: 1, sent: 1, failed: 0, lockHeld: true });
    const upd = callsMatching(poolQuery, "docs_reminder_count = $1");
    expect(upd).toHaveLength(1);
    expect(upd[0]![1]).toEqual([3, false, "a1"]);
  });
});
