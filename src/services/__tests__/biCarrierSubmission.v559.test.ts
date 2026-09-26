// BI_SERVER_BLOCK_v559_CARRIER_CATALOGUE
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCarrierEmail } from "../biCarrierSubmission";
const sql = readFileSync("src/db/migrations/2026_09_26_v559_bi_carrier_catalogue.sql", "utf8");
describe("v559 carrier catalogue", () => {
  it("adds TerrAssure (Canada only) and keeps it out of the US", () => {
    expect(sql).toMatch(/'cpl','CA','TerrAssure'/); expect(sql).toMatch(/'ppl','CA','TerrAssure'/); expect(sql).not.toMatch(/'US','TerrAssure'/);
  });
  it("adds the missing industries and Markel Canada / CFC lines", () => {
    for (const code of ["'financial'", "'energy'", "'transportation'"]) expect(sql).toContain(code);
    expect(sql).toContain("'Cyber 360 Canada'"); expect(sql).toContain("'Premises Pollution Liability (PPL)'"); expect(sql).toContain("'Contractor E&O'");
  });
  it("is idempotent; new client lines stay off until verified", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bi_carrier_products"); expect(sql.match(/ON CONFLICT/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("61,FALSE)"); expect(sql).toContain("verified BOOLEAN NOT NULL DEFAULT FALSE");
  });
});
describe("v559 carrier email", () => {
  it("summarises the risk and escapes HTML", () => {
    const m = buildCarrierEmail({ businessName: "Acme <Roofing>", applicationCode: "BI-123", country: "CA", coverage: "Contractors Pollution Liability",
      carrierProduct: "Contractors Pollution Liability (CPL)", limit: 2000000, note: null, staffName: "Andrew" });
    expect(m.subject).toBe("Submission: Contractors Pollution Liability - Acme <Roofing> (BI-123)");
    expect(m.html).toContain("Acme &lt;Roofing&gt;"); expect(m.text).toContain("Limit required by contract: $2,000,000"); expect(m.text).toContain("Andrew");
  });
  it("routes are staff-only", () => {
    const r = readFileSync("src/routes/biApplicationDetailRoutes.ts", "utf8");
    expect(r).toContain('"/:id/carrier-options", requireStaffOrAdmin');
    expect(r).toContain('"/:id/products/:productId/send-to-carrier", requireStaffOrAdmin');
  });
});
