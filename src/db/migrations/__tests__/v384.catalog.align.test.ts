import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(path.resolve(__dirname, "../2026_05_27_carrier_doc_catalog_align_v384.sql"), "utf8");

describe("v384 — carrier catalog alignment migration", () => {
  it("contains canonical doc slots", () => {
    expect(sql).toContain("loan_agreement");
    expect(sql).toContain("founder_cv");
    expect(sql).toContain("financial_forecast");
  });
  it("deactivates non-carrier slot", () => {
    expect(sql).toContain("annual_financials_3yr");
    expect(sql).toMatch(/SET active = FALSE/);
  });
});
