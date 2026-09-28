// BI_SERVER_PERSON_SUMMARY_v652
import { describe, expect, it } from "vitest";
import { findBiPerson, normalizePhone } from "../services/biPersonSummary";

function db(contacts: any[], apps: any[]) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  return {
    seen,
    async query(sql: string, params: unknown[]) {
      seen.push({ sql, params });
      if (sql.includes("FROM bi_contacts")) return { rows: contacts };
      if (sql.includes("FROM bi_applications")) return { rows: apps };
      throw new Error("unexpected SQL");
    },
  };
}

describe("v652 BI person summary", () => {
  it("normalizes North American phones", () => {
    expect(normalizePhone("(403) 555-0100")).toBe("+14035550100");
    expect(normalizePhone("1-403-555-0100")).toBe("+14035550100");
    expect(normalizePhone("12")).toBeNull();
  });

  it("requires an email or a phone", async () => {
    expect(await findBiPerson(db([], []), "", "")).toEqual({ ok: false, error: "email_or_phone_required" });
  });

  it("matches by lowercased email and E.164 phone and skips demo applications", async () => {
    const fake = db([{ id: "c1", name: "Sam" }], [{ public_id: "BI-1", stage: "quote_ready" }]);
    const out = await findBiPerson(fake, " Sam@Gym.CA ", "403 555 0100");
    expect(out.ok).toBe(true);
    expect(fake.seen[0].params).toEqual(["sam@gym.ca", "+14035550100"]);
    expect(fake.seen[1].sql).toContain("is_demo");
    expect(out).toMatchObject({ contact: { id: "c1" }, applications: [{ public_id: "BI-1" }], summary: "BI contact found; 1 PGI application(s)." });
  });

  it("says so when there is no BI record", async () => {
    const out = await findBiPerson(db([], []), "none@x.ca", null);
    expect(out).toMatchObject({ ok: true, contact: null, applications: [], summary: "No Boreal Insurance record for this person." });
  });
});
