// BI_SERVER_BLOCK_v107_TEST1_REGRESSION_FIX_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(
  path.resolve(__dirname, "../2026_05_27_carrier_doc_catalog_align_v384.sql"),
  "utf8",
);

describe("v384 — carrier catalog alignment migration", () => {
  it("contains the seven canonical doc slots", () => {
    expect(sql).toContain("loan_agreement");
    expect(sql).toContain("profit_loss");
    expect(sql).toContain("balance_sheet");
    expect(sql).toContain("ar_aging");
    expect(sql).toContain("ap_aging");
    expect(sql).toContain("founder_cv");
    expect(sql).toContain("financial_forecast");
  });
  it("deactivates non-carrier slots by exclusion list", () => {
    expect(sql).toMatch(/UPDATE bi_required_doc_catalog\s+SET active = FALSE/);
    expect(sql).toMatch(/WHERE doc_type NOT IN \(/);
  });
  it("uses idempotent INSERT ... ON CONFLICT DO UPDATE", () => {
    expect(sql).toContain("ON CONFLICT (doc_type) DO UPDATE");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bi_required_doc_catalog");
  });
});
