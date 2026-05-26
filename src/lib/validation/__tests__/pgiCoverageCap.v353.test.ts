// BI_SERVER_BLOCK_v353_PGI_COVERAGE_CAP_v1
import { describe, it, expect } from "vitest";
import {
  validatePgiSubmissionV2,
  PGI_COVERAGE_RATIO,
  LOAN_AMOUNT_MAX,
} from "../pgiFields";

function valid() {
  return {
    form_data: {
      q0_country: "Canada",
      q2_full_name: "Sarah Chen",
      q4_date_of_birth: "1985-06-15",
      q7_email: "sarah.chen@example.com",
      q5_residential_address: "456 Oak Avenue, Toronto, ON M4V 2P7, Canada",
      q_ca_id_type: "Driving Licence",
      q_ca_id_number: "DL123456789",
      q15_business_legal_name: "Maple Leaf Technologies Inc.",
      q17_business_operating_address: "789 King Street West, Toronto, ON M5H 2A9, Canada",
      q_business_province: "ON",
      q25_naics_code: "541511",
      q26_formation_date: "2019-03-15",
      q_ca_loan_type: "Commercial Mortgage",
      q41_loan_amount: 500_000,
      q42_pgi_limit: 400_000, // exactly 80% — should pass
      section_1_a: "yes",
      section_1_2: "no",
      section_2_a: "no",
      section_2_b: "no",
      section_2_c: "no",
      section_2_d: "no",
      section_3_a: "no",
      section_3_c: "Agree",
      section_4_a: "no",
      section_5_a: "no",
      section_6_a: "yes",
    },
  };
}

describe("v353 — 80% PGI coverage cap", () => {
  it("exposes the constant PGI_COVERAGE_RATIO = 0.80", () => {
    expect(PGI_COVERAGE_RATIO).toBe(0.80);
  });

  it("accepts pgi_limit at exactly 80% of loan_amount", () => {
    const v = valid();
    v.form_data.q41_loan_amount = 500_000;
    v.form_data.q42_pgi_limit = 400_000;
    expect(validatePgiSubmissionV2(v).ok).toBe(true);
  });

  it("accepts pgi_limit below 80% of loan_amount", () => {
    const v = valid();
    v.form_data.q41_loan_amount = 500_000;
    v.form_data.q42_pgi_limit = 250_000;
    expect(validatePgiSubmissionV2(v).ok).toBe(true);
  });

  it("rejects pgi_limit just above 80% of loan_amount", () => {
    const v = valid();
    v.form_data.q41_loan_amount = 500_000;
    v.form_data.q42_pgi_limit = 400_001;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.issues.find((i) => i.field === "form_data.q42_pgi_limit");
      expect(issue).toBeTruthy();
      expect(issue!.message).toMatch(/80% coverage cap/);
    }
  });

  it("rejects the OLD allowable shape (pgi_limit = loan_amount)", () => {
    // Pre-v353 this passed (≤ loan). Now must fail (> 80% × loan).
    const v = valid();
    v.form_data.q41_loan_amount = 600_000;
    v.form_data.q42_pgi_limit = 600_000;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
  });

  it("at the $1M loan ceiling, max allowed pgi_limit is $800K", () => {
    const v = valid();
    v.form_data.q41_loan_amount = LOAN_AMOUNT_MAX;
    v.form_data.q42_pgi_limit = 800_000;
    expect(validatePgiSubmissionV2(v).ok).toBe(true);
    v.form_data.q42_pgi_limit = 800_001;
    expect(validatePgiSubmissionV2(v).ok).toBe(false);
  });

  it("still rejects pgi_limit > $1M cap even when 80% of loan_amount would allow it", () => {
    // Theoretical: if loan were $2M, 80% would be $1.6M. But the absolute cap
    // is $1M, which always applies first because loan_amount > $1M is itself rejected.
    const v = valid();
    v.form_data.q41_loan_amount = 2_000_000; // already invalid (above $1M cap)
    v.form_data.q42_pgi_limit = 1_500_000;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
  });
});
