// BI_SERVER_LEAD_SCORES_v1 - same scale and grades as BF.
import { describe, expect, it } from "vitest";
import { lookupLeadScores, scoreOne } from "../leadScores";

describe("BI lead scores", () => {
  it("scores profile and engagement, capped, with grades", () => {
    expect(scoreOne({}).score).toBe(0);
    expect(scoreOne({}).grade).toBe("cold");
    const warm = scoreOne({ phone_e164: "+14035550100", company_id: "c", title: "Owner", opens: 3 });
    expect(warm.score).toBe(31);
    const hot = scoreOne({ phone_e164: "+1", company_id: "c", title: "CEO", tags: ["Website form"], max_coverage: 75000, opens: 50, clicks: 1, apps: 1, apps_moved: 1 });
    expect(hot.score).toBe(100);
    expect(hot.grade).toBe("hot");
    expect(hot.breakdown.find((b) => b.label.startsWith("Email opens"))?.points).toBe(20);
  });
  it("looks up only valid ids", async () => {
    const calls: unknown[][] = [];
    const db = { query: async (_sql: string, params?: unknown[]) => { calls.push(params ?? []); return { rows: [{ id: "11111111-1111-4111-8111-111111111111", phone_e164: "+1", apps: 1 }] }; } };
    const out = await lookupLeadScores(db, ["11111111-1111-4111-8111-111111111111", "nope"]);
    expect(calls[0]).toEqual([["11111111-1111-4111-8111-111111111111"]]);
    expect(out["11111111-1111-4111-8111-111111111111"]?.score).toBe(30);
    expect(await lookupLeadScores(db, [])).toEqual({});
  });
});
