import { describe, expect, it } from "vitest";
// BI_LENDER_SUBMIT_V2_VALIDATOR_v1 - these assertions describe V2, which is
// now what every PGI submission path uses.
import { validatePgiSubmissionV2 as validatePgiSubmission } from "../pgiFields";

function valid() {
  return { form_data: {
    q0_country: "Canada", q2_full_name: "Sarah Chen", q4_date_of_birth: "1985-06-15",
    q7_email: "sarah@example.com", q5_residential_address: "456 Oak Ave, Toronto, ON",
    q_ca_id_type: "Driving Licence", q_ca_id_number: "DL123456789",
    q15_business_legal_name: "Maple Leaf Tech Inc.",
    q17_business_operating_address: "789 King St W, Toronto, ON", q_business_province: "ON",
    q25_naics_code: "541511", q26_formation_date: "2019-03-15",
    q_ca_loan_type: "Commercial Mortgage", q41_loan_amount: 500_000, q42_pgi_limit: 250_000,
    section_1_a: "yes", section_1_2: "no", section_2_a: "no", section_2_b: "no",
    section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree",
    section_4_a: "no", section_5_a: "no", section_6_a: "yes",
  } };
}

describe("PGI lender submission validator", () => {
  it("accepts a fully valid V2 submission", () => {
    expect(validatePgiSubmission(valid()).ok).toBe(true);
  });
  it("rejects pgi_limit above the coverage cap", () => {
    const v = valid(); v.form_data.q42_pgi_limit = 400_001;
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
  it("rejects loan amounts above $1M", () => {
    const v = valid(); v.form_data.q41_loan_amount = 1_000_001;
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
  it("rejects unsupported country", () => {
    const v = valid(); v.form_data.q0_country = "MX";
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
  it("rejects non-6-digit NAICS", () => {
    const v = valid(); v.form_data.q25_naics_code = "54151";
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
  it("rejects non-ISO formation_date", () => {
    const v = valid(); v.form_data.q26_formation_date = "March 15, 2019";
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
  it("rejects when a required disclosure is missing", () => {
    const v = valid(); delete (v.form_data as Partial<typeof v.form_data>).section_1_a;
    expect(validatePgiSubmission(v).ok).toBe(false);
  });
});
