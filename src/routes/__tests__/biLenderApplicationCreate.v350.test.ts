// BI_SERVER_BLOCK_v350_LENDER_PURBECK_ALIGNMENT_v1
import { describe, it, expect } from "vitest";

// This test validates the SHAPE of the v350 changes by reading the source
// file rather than booting the express app (which requires the live DB).
// CI catches regressions where someone accidentally re-adds risk booleans
// to the required-fields list or removes the v350 server-side guards.
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../biLenderApplicationCreate.ts"),
  "utf8",
);

describe("biLenderApplicationCreate (v350)", () => {
  it("does NOT require bankruptcy_history / insolvency_history / judgment_history in lender body", () => {
    // The v349 hard-cut applies to the lender path too.
    const requiredStart = src.indexOf("const required: Array<[string, any]> = [");
    const requiredEnd = src.indexOf("const missing = required.filter", requiredStart);
    const requiredBlock = src.slice(requiredStart, requiredEnd);
    expect(requiredBlock).not.toMatch(/bankruptcy_history/);
    expect(requiredBlock).not.toMatch(/insolvency_history/);
    expect(requiredBlock).not.toMatch(/judgment_history/);
  });

  it("requires business.province (needed for QC block)", () => {
    expect(src).toMatch(/business\.province/);
  });

  it("requires loan.q_ca_loan_type", () => {
    expect(src).toMatch(/loan\.q_ca_loan_type/);
  });

  it("contains Quebec server-side block", () => {
    expect(src).toMatch(/quebec_blocked/);
    expect(src).toMatch(/PGI does not currently write business in Quebec/);
  });

  it("contains 1M cap server-side check on loan amount", () => {
    expect(src).toMatch(/loan_amount_over_cap/);
    expect(src).toMatch(/1[,_]?000[,_]?000/);
  });

  it("contains 1M cap server-side check on PGI limit", () => {
    expect(src).toMatch(/pgi_limit_over_cap/);
  });

  it("contains loan-type allowlist (Commercial Mortgage / Other Secured Loan only)", () => {
    expect(src).toMatch(/Commercial Mortgage/);
    expect(src).toMatch(/Other Secured Loan/);
    expect(src).toMatch(/loan_type_ineligible/);
  });

  it("persists declarations to JSONB column and co_guarantors to table", () => {
    expect(src).toMatch(/declarations\s*=\s*\$1::jsonb/);
    expect(src).toMatch(/INSERT INTO bi_co_guarantors/);
    expect(src).toMatch(/has_co_guarantors/);
  });
});
