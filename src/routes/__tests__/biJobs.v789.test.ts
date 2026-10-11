// BI_SERVER_v789_ADVISORY_LOCK_ONE_CLIENT + BI_SERVER_v789_LOG_MASKING
// The docs-reminder advisory lock is taken and released on the SAME client;
// failure logs carry masked phone numbers.
import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQuery = vi.fn();
type FakeClient = { name: string; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
const clients: FakeClient[] = [];
let lockGranted = true;
function makeClient(): FakeClient {
  const c: FakeClient = {
    name: `client-${clients.length + 1}`,
    query: vi.fn(async (sql: string) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: lockGranted }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ pg_advisory_unlock: true }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  clients.push(c);
  return c;
}
vi.mock("../../db", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a), connect: async () => makeClient() },
}));
const logs = vi.hoisted(() => ({ error: [] as unknown[][] }));
vi.mock("../../platform/logger", () => ({
  logger: { error: (...a: unknown[]) => { logs.error.push(a); }, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../platform/env", () => ({ env: { BI_ESCALATION_PHONE: "+15875550000" } }));
vi.mock("../../services/smsService", () => ({ sendOutreachSms: vi.fn(async () => { throw new Error("twilio down"); }) }));
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn(async () => ({ channel: "none", error: "no_device" })) }));

import { runDocsReminderCronTick } from "../biJobs";
import { sendOutreachSms } from "../../services/smsService";
import { notifyBiClient } from "../../services/notifyBiClient";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

beforeEach(() => {
  clients.length = 0;
  lockGranted = true;
  logs.error.length = 0;
  poolQuery.mockReset().mockImplementation(answerBySql([
    ["FROM bi_applications a", { rows: [{ id: "a1", public_id: "BI-1", business_name: "Acme", docs_reminder_count: 0, sms_to: "+15875551234" }] }],
  ]));
});

describe("docs reminder cron advisory lock (v789)", () => {
  it("takes and releases the advisory lock on the same client, then releases the client", async () => {
    const out = await runDocsReminderCronTick();
    expect(out.lockHeld).toBe(true);
    expect(clients).toHaveLength(1);
    const c = clients[0]!;
    const sqls = c.query.mock.calls.map((x) => String(x[0]));
    expect(sqls.some((s) => /pg_try_advisory_lock/.test(s))).toBe(true);
    expect(sqls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
    expect(c.release).toHaveBeenCalledTimes(1);
    // Nothing lock-related went through the pool (which could pick another connection).
    expect(callsMatching(poolQuery, /advisory/)).toHaveLength(0);
  });

  it("releases the client without unlocking when the lock is held elsewhere", async () => {
    lockGranted = false;
    const out = await runDocsReminderCronTick();
    expect(out).toEqual({ scanned: 0, sent: 0, escalated: 0, failed: 0, lockHeld: false });
    const c = clients[0]!;
    expect(c.query.mock.calls.some((x) => /pg_advisory_unlock/.test(String(x[0])))).toBe(false);
    expect(c.release).toHaveBeenCalledTimes(1);
  });

  it("logs a failed reminder with the phone masked to its last 4 digits", async () => {
    const out = await runDocsReminderCronTick();
    expect(out.failed).toBe(1);
    const entry = logs.error.find((a) => a[1] === "bi_docs_reminder_send_failed");
    expect(entry).toBeDefined();
    const fields = entry![0] as { phone: string };
    expect(fields.phone).toBe("***1234");
    expect(JSON.stringify(entry)).not.toContain("5875551234");
  });

  it("escalates to the validated env BI_ESCALATION_PHONE after the last reminder, masking it in failure logs", async () => {
    poolQuery.mockImplementation(answerBySql([
      ["FROM bi_applications a", { rows: [{ id: "a1", public_id: "BI-1", business_name: "Acme", docs_reminder_count: 9, sms_to: "+15875551234" }] }],
    ]));
    vi.mocked(notifyBiClient).mockResolvedValueOnce({ channel: "push" } as any);
    const out = await runDocsReminderCronTick();
    expect(out.sent).toBe(1);
    expect(vi.mocked(sendOutreachSms).mock.calls[0]![0]).toBe("+15875550000");
    const entry = logs.error.find((a) => a[1] === "bi_escalation_sms_failed");
    expect((entry![0] as { phone: string }).phone).toBe("***0000");
  });
});
