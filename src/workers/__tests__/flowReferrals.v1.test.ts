// BI_SERVER_AUTO_REPLY_REFERRALS_v1
import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
import { addReferrals } from "../flowWorker";

function fakeDb(existing: string[] = []) {
  const calls: Array<[string, unknown[]]> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    if (/FROM bi_contacts WHERE lower\(btrim\(email\)\) = \$1 ORDER BY/.test(sql)) return { rows: [{ id: "c1", company_id: "co1", tags: ["lender", "us lender list"], country: "US", full_name: "Dave Kenney" }], rowCount: 1 };
    if (/SELECT 1 FROM bi_contacts/.test(sql)) return { rows: [], rowCount: existing.includes(String(params[0])) ? 1 : 0 };
    return { rows: [{ id: "n" }], rowCount: 1 };
  });
  return { db: { query } as any, calls };
}

describe("colleagues named in an auto-reply", () => {
  it("are added at the same company with the same tags, once", async () => {
    const { db, calls } = fakeDb(["megan@bank.com"]);
    const n = await addReferrals(db, { from: "dave@bank.com", at: "2026-11-25T16:16:00Z", auto_reply: true, left: false,
      referrals: [{ email: "tyler@bank.com", name: "Tyler Wright", phone: "443 675 6196" }, { email: "megan@bank.com", name: "Megan Newcomb", phone: null }] });
    expect(n).toBe(1);
    const ins = calls.find(([s]) => /INSERT INTO bi_contacts/.test(s))!;
    expect(ins[1].slice(0, 7)).toEqual(["Tyler Wright", "Tyler", "Wright", "tyler@bank.com", "co1", ["lender", "us lender list", "referred by auto-reply"], "US"]);
    expect(calls.some(([s]) => /outreach_excluded = TRUE/.test(s))).toBe(false);
  });

  it("takes a sender who has left off outreach", async () => {
    const { db, calls } = fakeDb();
    await addReferrals(db, { from: "scott@dbl.com", at: "x", auto_reply: true, left: true, referrals: [] });
    expect(calls.some(([s]) => /outreach_excluded = TRUE/.test(s))).toBe(true);
  });
});
