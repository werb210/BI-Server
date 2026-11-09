// BI_SERVER_COMPANY_FROM_EMAIL_v1 - parity with BF-Server v925.
import { describe, expect, it, vi } from "vitest";
vi.mock("../../../db", () => ({ pool: { query: vi.fn() } }));
import { companyNameFromDomain, emailDomain, linkCompaniesFromEmail } from "../companyFromEmail";

describe("company from email domain", () => {
  it("uses work domains only and names from the domain", () => {
    expect(emailDomain("kathrina.pielago@signnow.com")).toBe("signnow.com");
    expect(emailDomain("x@gmail.com")).toBeNull();
    expect(companyNameFromDomain("allen-capital.co.uk")).toBe("Allen Capital");
  });

  it("links to a matching company, creates a missing one", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const db = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (sql.includes("FROM bi_contacts c")) return { rows: [{ id: "c1", email: "a@acme.com" }, { id: "c2", email: "b@newco.ca" }, { id: "c3", email: "z@gmail.com" }] };
      if (sql.includes("FROM bi_companies")) return { rows: params[0] === "acme.com" ? [{ id: "co-acme" }] : [] };
      if (sql.includes("INSERT INTO bi_companies")) return { rows: [{ id: "co-new" }] };
      if (sql.includes("UPDATE bi_contacts")) return { rows: [], rowCount: 1 };
      throw new Error("unexpected " + sql);
    }) };
    expect(await linkCompaniesFromEmail(db as any)).toEqual({ linked: 2, created: 1 });
    const ins = calls.find(([s]) => s.includes("INSERT INTO bi_companies"))!;
    expect(ins[1]).toEqual(["Newco", "newco.ca", "https://newco.ca"]);
    const ups = calls.filter(([s]) => s.includes("UPDATE bi_contacts")).map(([, p]) => p);
    expect(ups).toEqual([["c1", "co-acme"], ["c2", "co-new"]]);
  });
});
