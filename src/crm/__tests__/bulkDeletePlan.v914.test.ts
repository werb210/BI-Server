// BI_SERVER_v914_PARTIAL_BULK_DELETE - answers by SQL content, not call order.
import { describe, expect, it } from "vitest";
import { clearContactSendHistory, planCompanyDelete, planContactDelete } from "../bulkDeletePlan";

function db(onApp: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (/FROM bi_contacts c/.test(sql) || /FROM bi_companies co/.test(sql)) {
        const ids = (params?.[0] as string[]) ?? [];
        return { rows: ids.filter((id) => onApp[id]).map((id) => ({ id, name: onApp[id] })) };
      }
      if (/DELETE FROM bi_marketing_send_recipients/.test(sql)) return { rows: [], rowCount: 3 };
      throw new Error("unexpected sql " + sql);
    },
  };
}

describe("BI partial bulk delete", () => {
  it("keeps contacts on an application and deletes the rest", async () => {
    const d = db({ c2: "Jane Applicant" });
    const plan = await planContactDelete(d, ["c1", "c2", "c3"]);
    expect(plan.deletable).toEqual(["c1", "c3"]);
    expect(plan.skipped).toEqual([{ id: "c2", name: "Jane Applicant", reason: "linked to an application" }]);
  });
  it("keeps companies on an application", async () => {
    const plan = await planCompanyDelete(db({ k1: "Acme Ltd" }), ["k1", "k2"]);
    expect(plan.deletable).toEqual(["k2"]);
    expect(plan.skipped[0]).toMatchObject({ id: "k1", reason: "linked to an application" });
  });
  it("nothing selected is a no-op", async () => {
    const d = db({});
    expect(await planContactDelete(d, [])).toEqual({ deletable: [], skipped: [] });
    await clearContactSendHistory(d, []);
    expect(d.calls).toHaveLength(0);
  });
  it("clears campaign recipients that would block the delete", async () => {
    const d = db({});
    await clearContactSendHistory(d, ["c1"]);
    expect(d.calls[0]).toMatch(/DELETE FROM bi_marketing_send_recipients/);
  });
});
