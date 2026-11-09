// BI_SERVER_SHARED_PHONE_v1 - an office main line shared by many contacts is not a duplicate reason on its own.
import { describe, expect, it } from "vitest";
import { duplicateGroups, contactDuplicates, SHARED_PHONE_LIMIT } from "../duplicates";

const MAIN = "+14163203138";
function person(i: number, phone: string | null, extra: Record<string, unknown> = {}) {
  return { id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, full_name: `Person ${i} Surname${i}`, email: `p${i}@example.com`,
    phone_e164: phone, company_id: null, created_at: "2026-05-28T00:00:00Z", company_name: "Example Lending LP", application_count: 0, ...extra };
}
function db(rows: any[]) {
  return {
    query: async (sql: string) => {
      if (sql.includes("bi_crm_duplicate_dismissals")) return { rows: [] };
      if (sql.includes("FROM bi_contacts")) return { rows };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  } as any;
}

describe("shared office phone", () => {
  it("does not group many people who share one main line", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => person(i + 1, MAIN));
    expect(await duplicateGroups(db(rows), "contact")).toEqual([]);
  });

  it("still groups a number shared by a few records", async () => {
    const rows = [person(1, "+14035550101"), person(2, "+1 403 555 0101"), person(3, MAIN)];
    const groups = await duplicateGroups(db(rows), "contact");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reasons).toEqual(["Same phone"]);
    expect(SHARED_PHONE_LIMIT).toBe(3);
  });

  it("still matches people on the shared line by email or name", async () => {
    const rows = [...Array.from({ length: 8 }, (_, i) => person(i + 1, MAIN)), person(20, MAIN, { email: "p1@example.com" })];
    const groups = await duplicateGroups(db(rows), "contact");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reasons).toEqual(["Same email"]);
  });

  it("the contact banner ignores the shared line too", async () => {
    const me = person(1, MAIN);
    const others = Array.from({ length: 6 }, (_, i) => person(i + 2, MAIN));
    const q = { query: async (sql: string) => {
      if (sql.includes("bi_crm_duplicate_dismissals")) return { rows: [] };
      if (sql.includes("WHERE id = $1::uuid")) return { rows: [me] };
      if (sql.includes("FROM bi_contacts c")) return { rows: others };
      throw new Error(`unexpected SQL: ${sql}`);
    } } as any;
    expect(await contactDuplicates(q, me.id)).toEqual([]);
  });
});
