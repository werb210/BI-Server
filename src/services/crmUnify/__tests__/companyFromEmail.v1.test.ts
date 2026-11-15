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

  // BI_SERVER_COMPANY_FROM_EMAIL_v2
  it("a company of the same name with no domain is reused; one with another domain gets a distinct name; a failure skips only that contact", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const db = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (sql.includes("FROM bi_contacts c")) return { rows: [{ id: "c1", email: "a@acme.com" }, { id: "c2", email: "b@summit.ca" }, { id: "c3", email: "c@broken.io" }, { id: "c4", email: "d@fine.org" }] };
      if (sql.includes("lower(legal_name) = lower($1)")) return { rows: params[0] === "Acme" ? [{ id: "co-acme", domain: null }] : params[0] === "Summit" ? [{ id: "co-summit", domain: "summit.com" }] : [] };
      if (sql.includes("FROM bi_companies")) return { rows: [] };
      if (sql.includes("UPDATE bi_companies")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO bi_companies")) { if (params[1] === "broken.io") throw new Error("duplicate key value"); return { rows: [{ id: "co-" + params[1] }] }; }
      if (sql.includes("UPDATE bi_contacts")) return { rows: [], rowCount: 1 };
      throw new Error("unexpected " + sql);
    }) };
    expect(await linkCompaniesFromEmail(db as any)).toEqual({ linked: 3, created: 2 });
    expect(calls.find(([q]) => q.includes("UPDATE bi_companies"))![1]).toEqual(["co-acme", "acme.com", "https://acme.com"]);
    const inserts = calls.filter(([q]) => q.includes("INSERT INTO bi_companies")).map(([, p]) => p[0]);
    expect(inserts).toEqual(["Summit (summit.ca)", "Broken", "Fine"]);
    expect(calls.filter(([q]) => q.includes("UPDATE bi_contacts")).map(([, p]) => p)).toEqual([["c1", "co-acme"], ["c2", "co-summit.ca"], ["c4", "co-fine.org"]]);
  });
});
