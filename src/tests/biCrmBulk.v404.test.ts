import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const r = readFileSync("src/routes/biCrmRoutes.ts", "utf-8");
describe("v404 BI CRM bulk endpoints", () => {
  it("contacts bulk-delete + bulk-tag", () => {
    expect(r).toContain('"/crm/contacts/bulk-delete"');
    expect(r).toContain('"/crm/contacts/bulk-tag"');
    expect(r).toContain("DELETE FROM bi_contacts WHERE id = ANY($1::uuid[])");
  });
  it("companies bulk-delete + bulk-tag", () => {
    expect(r).toContain('"/crm/companies/bulk-delete"');
    expect(r).toContain('"/crm/companies/bulk-tag"');
    expect(r).toContain("DELETE FROM bi_companies WHERE id = ANY($1::uuid[])");
  });
});
