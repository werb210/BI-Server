// BI_SERVER_v856_CRM_UNIFY - the second round's rules in BI: advisor tags on the shared core list, partner / guarantor
// system tags, the same-name and shortened-company duplicate rules, the placeholder survivor, and people from an
// application becoming contacts (database faked by SQL content).
import { describe, expect, it } from "vitest";
import { normalizeTag, tagKind } from "../tags";
import { companyNamesSimilar, isPlaceholderName, sameFullName, suggestSurvivor } from "../duplicates";
import { syncBiApplicationPeople } from "../peopleSync";

type Row = Record<string, any>;
function fakeDb(handlers: Array<[RegExp, (p: any[]) => Row[]]>) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  return {
    calls,
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) { const rows = fn(params); return { rows, rowCount: rows.length }; }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("tags", () => {
  it("maps advisor tags onto the shared core list; people tags are automatic", () => {
    expect(normalizeTag("Lawyer/advisor")).toBe("lawyer");
    expect(normalizeTag("A/R Credit Insurance/advisor")).toBe("ar_credit_insurance");
    expect(tagKind("insurance")).toBe("core");
    expect(tagKind("partner")).toBe("system");
  });
});

describe("duplicates", () => {
  it("same full name anywhere, shortened company names, placeholders", () => {
    expect(sameFullName("Todd Werboweski", "todd  WERBOWESKI")).toBe(true);
    expect(sameFullName("Unknown (application started)", "Unknown (application started)")).toBe(false);
    expect(companyNamesSimilar("Big Brokerage", "Big Broker")).toBe(true);
    expect(isPlaceholderName("New applicant")).toBe(true);
    expect(suggestSurvivor([{ id: "p", name: "Unknown (application started)", created_at: "2026-01-01" }, { id: "r", name: "Rae Real", created_at: "2026-02-01" }])).toBe("r");
  });
});

describe("people from an application", () => {
  it("creates the director and guarantor with their tags and links them to the company", async () => {
    const created: Row[] = [];
    const db = fakeDb([
      [/FROM bi_applications a LEFT JOIN bi_contacts c/, () => [{
        id: "a1", contact_id: "brandon", company_id: "voss", directors: [{ name: "Dana Director", email: "DANA@x.co" }],
        guarantor_name: "Gus Guarantor", guarantor_email: "gus@x.co", guarantor_phone: null, data: {}, form_data: null,
      }]],
      [/INSERT INTO bi_contacts/, (p) => { created.push({ name: p[0], email: p[3], tag: p[7] }); return [{ id: `new-${created.length}` }]; }],
    ]);
    const out = await syncBiApplicationPeople(db, "a1");
    expect(out.created).toBe(2);
    expect(created).toEqual([{ name: "Dana Director", email: "dana@x.co", tag: "partner" }, { name: "Gus Guarantor", email: "gus@x.co", tag: "guarantor" }]);
    const links = db.calls.filter((c) => /INSERT INTO bi_crm_company_people/.test(c.sql)).map((c) => c.params.slice(0, 3));
    expect(links).toEqual([["voss", "brandon", "primary_applicant"], ["voss", "new-1", "partner"], ["voss", "new-2", "guarantor"]]);
  });
});
