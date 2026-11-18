// BI_SERVER_BF_ADDON_QUIET_v1 - PGI add-ons from Boreal Financial are not nudged before the term sheet arrives.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../db", () => ({
  pool: { query: vi.fn(async (sql: string) => { calls.push(sql); return { rows: [] }; }) },
}));
vi.mock("../services/smsService", () => ({ sendOutreachSms: vi.fn() }));

describe("abandoned PGI nudge", () => {
  beforeEach(() => { calls.length = 0; });

  it("only picks a BF add-on once its signed term sheet / loan agreement has come across", async () => {
    const { runAbandonedNudgeTick } = await import("../workers/abandonedApplicationNudge");
    await runAbandonedNudgeTick().catch(() => undefined);
    const nudgeQueries = calls.filter((s) => s.includes("abandon_nudge"));
    expect(nudgeQueries.length).toBeGreaterThanOrEqual(2);
    for (const q of nudgeQueries.filter((s) => s.trim().startsWith("SELECT"))) {
      expect(q).toContain("COALESCE(source, '') <> 'bf_pgi_referral'");
      expect(q).toMatch(/loan_agreement%/);
    }
  });
});
