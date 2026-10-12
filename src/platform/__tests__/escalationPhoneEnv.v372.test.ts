// BI_SERVER_BLOCK_v372_ESCALATION_PHONE_ENV_v1
// BI_SERVER_v789 - rewritten as a behaviour test (it used to assert on the
// source text of env.ts and biJobs.ts).
import { describe, it, expect, vi, afterEach } from "vitest";

const saved = process.env.BI_ESCALATION_PHONE;
afterEach(() => {
  if (saved === undefined) delete process.env.BI_ESCALATION_PHONE; else process.env.BI_ESCALATION_PHONE = saved;
  vi.doUnmock("../../db");
  vi.doUnmock("../../platform/env");
  vi.doUnmock("../../services/smsService");
  vi.doUnmock("../../services/notifyBiClient");
  vi.doUnmock("../../platform/logger");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadEnv() {
  vi.resetModules();
  return (await import("../env")).env;
}

describe("v372 - BI_ESCALATION_PHONE in validated env", () => {
  it("an E.164 BI_ESCALATION_PHONE is parsed into env", async () => {
    process.env.BI_ESCALATION_PHONE = "+15875550000";
    expect((await loadEnv()).BI_ESCALATION_PHONE).toBe("+15875550000");
  });

  it("is optional", async () => {
    delete process.env.BI_ESCALATION_PHONE;
    expect((await loadEnv()).BI_ESCALATION_PHONE).toBeUndefined();
  });

  it("a non-E.164 value fails env validation", async () => {
    process.env.BI_ESCALATION_PHONE = "587-555-0000";
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(loadEnv()).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("biJobs escalates to the validated env value after the last reminder", async () => {
    vi.resetModules();
    const sendOutreachSms = vi.fn(async () => ({ sid: "S1" }));
    vi.doMock("../../platform/env", () => ({ env: { BI_ESCALATION_PHONE: "+15875550000" } }));
    vi.doMock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    vi.doMock("../../services/smsService", () => ({ sendOutreachSms }));
    vi.doMock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn(async () => ({ channel: "push" })) }));
    const { answerBySql } = await import("../../__tests__/helpers/answerBySql");
    const query = vi.fn(answerBySql([
      ["FROM bi_applications a", { rows: [{ id: "a1", public_id: "BI-1", business_name: "Acme", docs_reminder_count: 9, sms_to: "+15875551234" }] }],
    ]));
    vi.doMock("../../db", () => ({
      pool: {
        query,
        connect: async () => ({
          query: async (sql: string) => (/pg_try_advisory_lock/.test(sql) ? { rows: [{ locked: true }] } : { rows: [] }),
          release: () => undefined,
        }),
      },
    }));
    const { runDocsReminderCronTick } = await import("../../routes/biJobs");
    const out = await runDocsReminderCronTick();
    expect(out.escalated).toBe(1);
    expect(sendOutreachSms).toHaveBeenCalledTimes(1);
    expect((sendOutreachSms.mock.calls[0] as unknown[])[0]).toBe("+15875550000");
  });
});
