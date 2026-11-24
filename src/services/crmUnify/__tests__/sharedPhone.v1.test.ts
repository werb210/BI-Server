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
    const rows = [person(1, "+14035550101"), person(2, "+1 403 555 0101", { full_name: "Unknown (application started)" }), person(3, MAIN)];
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

  // BI_SERVER_DUP_NAMES_v2
  it("does not group two different people who share a company phone", async () => {
    const rows = [
      person(1, "+15065550111", { full_name: "Jocelyn Parker-Whalley", email: "jpw@example.com" }),
      person(2, "+15065550111", { full_name: "Larry Hachey", email: "lh@example.com" }),
      person(3, "+15145550122", { full_name: "Christian Genesse", email: null }),
      person(4, "+15145550122", { full_name: "Mathieu Marengere", email: null }),
    ];
    expect(await duplicateGroups(db(rows), "contact")).toEqual([]);
  });

  it("keeps real duplicates: same name, a placeholder on the same phone, a nickname on the same email", async () => {
    const rows = [
      person(1, "+15875550133", { full_name: "Dolly Myerson", email: "dolly@example.com" }),
      person(2, "+15875550133", { full_name: "Dylan Myerson", email: "dylan@example.com" }),
      person(3, "+14035550144", { full_name: "Ann Lee", email: "ann@example.com" }),
      person(4, null, { full_name: "Ann Lee", email: "ann.lee@example.com" }),
      person(5, "+17805550155", { full_name: "Sam Ray", email: "sr@example.com" }),
      person(6, "+17805550155", { full_name: "Unknown (application started)", email: null }),
      person(7, null, { full_name: "Bob Smith", email: "bsmith@example.com" }),
      person(8, null, { full_name: "Robert Smith", email: "bsmith@example.com" }),
    ];
    const groups = await duplicateGroups(db(rows), "contact");
    const sets = groups.map((g) => g.ids.map((id) => Number(id.slice(-2))).sort((a, b) => a - b));
    expect(sets).toEqual(expect.arrayContaining([[3, 4], [5, 6], [7, 8]]));
    expect(sets).toHaveLength(3);
  });

  // BI_SERVER_PLACEHOLDER_NAMES_v2
  it("never groups research placeholders like (name not found) by name", async () => {
    const rows = [
      person(31, null, { full_name: "(name not found)", email: null }),
      person(32, null, { full_name: "(name not found)", email: null }),
      person(33, null, { full_name: "(CEO not identified)", email: null }),
      person(34, null, { full_name: "(CEO not identified)", email: null }),
    ];
    expect(await duplicateGroups(db(rows), "contact")).toEqual([]);
  });
});
