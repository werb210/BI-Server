import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";
const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: queryMock } }));
describe("BI_PGI_ALIGNMENT_v56 crmMirrorService", () => {
  beforeEach(() => { vi.resetModules(); queryMock.mockReset(); });
  it("updates an existing contact found by email and accumulates tags", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_companies", { rows: [{ id: "co-1" }] }],
      ["FROM bi_contacts", { rows: [{ id: "c-1" }] }],
      ["UPDATE bi_contacts", { rowCount: 1, rows: [] }],
    ], queryMock.getMockImplementation()));
    const { mirrorToContact } = await import("../crmMirrorService");
    const r = await mirrorToContact({ source: "lender", full_name: "Bob", email: "bob@x.com", company_name: "Acme" });
    expect(r.created).toBe(false);
  });
});
