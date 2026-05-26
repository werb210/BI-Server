// BI_SERVER_BLOCK_v355_LENDER_OPENAPI_V2_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biLenderOpenApi.ts"), "utf8");

describe("v355 — OpenAPI v2 carrier alignment", () => {
  it("spec version is 2.0.0", () => {
    expect(src).toMatch(/version:\s*"2\.0\.0"/);
  });

  it("ApplicationSubmit requires the v2 nested shape", () => {
    const m = src.match(/ApplicationSubmit:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const required = m![1];
    expect(required).toMatch(/"guarantor"/);
    expect(required).toMatch(/"business"/);
    expect(required).toMatch(/"loan"/);
    expect(required).toMatch(/"declarations"/);
  });

  it("Guarantor schema requires the 4 v2-new fields (dob, address, ID type, ID number)", () => {
    const m = src.match(/Guarantor:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const required = m![1];
    expect(required).toMatch(/"dob"/);
    expect(required).toMatch(/"address"/);
    expect(required).toMatch(/"q_ca_id_type"/);
    expect(required).toMatch(/"q_ca_id_number"/);
  });

  it("Business schema requires province + naics + start_date + address", () => {
    const m = src.match(/Business:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/"province"/);
    expect(m![1]).toMatch(/"naics"/);
    expect(m![1]).toMatch(/"start_date"/);
    expect(m![1]).toMatch(/"address"/);
  });

  it("Loan schema requires q_ca_loan_type and constrains to the 2 allowed values", () => {
    const m = src.match(/Loan:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\]/);
    expect(m![1]).toMatch(/"q_ca_loan_type"/);
    expect(src).toMatch(/enum:\s*\["Commercial Mortgage",\s*"Other Secured Loan"\]/);
  });

  it("Declarations schema requires all 11 keys", () => {
    const m = src.match(/Declarations:\s*\{[\s\S]*?required:\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const required = m![1];
    for (const k of ["section_1_a", "section_1_2", "section_2_a", "section_2_b", "section_2_c", "section_2_d", "section_3_a", "section_3_c", "section_4_a", "section_5_a", "section_6_a"]) {
      expect(required).toContain(`"${k}"`);
    }
  });

  it("Document doc_type enum has exactly the 7 carrier-allowed values", () => {
    const docTypeMatches = src.match(/doc_type:[\s\S]*?enum:\s*\[([\s\S]*?)\]/);
    expect(docTypeMatches).toBeTruthy();
    const values = docTypeMatches![1].match(/"[a-z_]+"/g) || [];
    expect(values).toContain('"loan_agreement"');
    expect(values).toContain('"profit_loss"');
    expect(values).toContain('"balance_sheet"');
    expect(values).toContain('"ar_aging"');
    expect(values).toContain('"ap_aging"');
    expect(values).toContain('"founder_cv"');
    expect(values).toContain('"financial_forecast"');
    // No stale values
    expect(values).not.toContain('"guarantor_id"');
    expect(values).not.toContain('"financial_statements"');
  });

  it("ApplicationResponse status enum uses the canonical v351 stages", () => {
    expect(src).toMatch(/"created"/);
    expect(src).toMatch(/"under_review"/);
    expect(src).toMatch(/"information_required"/);
    expect(src).toMatch(/"policy_issued"/);
    // Stale stages from v1 spec
    expect(src).not.toMatch(/"new_application"/);
    expect(src).not.toMatch(/"sent_to_pgi"/);
  });

  it("Eligibility rules described in info.description", () => {
    expect(src).toMatch(/Canada only/);
    expect(src).toMatch(/Quebec excluded/);
    expect(src).toMatch(/50,000/);
    expect(src).toMatch(/1,000,000/);
    expect(src).toMatch(/80%/);
  });

  it("Provides a complete example payload in ApplicationSubmit", () => {
    expect(src).toMatch(/example:\s*\{[\s\S]*?company_name:\s*"Maple Leaf Technologies Inc\."/);
  });
});
