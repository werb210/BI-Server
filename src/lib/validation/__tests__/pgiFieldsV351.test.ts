// BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1
import { describe, it, expect } from "vitest";
import {
  validatePgiSubmissionV2,
  LOAN_AMOUNT_MIN,
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
      q42_pgi_limit: 250_000,
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

describe("v351 — q7_email now required", () => {
  it("accepts valid email", () => {
    expect(validatePgiSubmissionV2(valid()).ok).toBe(true);
  });
  it("rejects missing q7_email", () => {
    const v = valid(); delete (v.form_data as any).q7_email;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some(i => i.field === "form_data.q7_email")).toBe(true);
  });
  it("rejects malformed q7_email", () => {
    const v = valid(); v.form_data.q7_email = "not-an-email";
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
  });
});

describe("v351 — q_ca_id_type / q_ca_id_number now required", () => {
  it("rejects missing q_ca_id_type", () => {
    const v = valid(); delete (v.form_data as any).q_ca_id_type;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some(i => i.field === "form_data.q_ca_id_type")).toBe(true);
  });
  it("rejects missing q_ca_id_number", () => {
    const v = valid(); delete (v.form_data as any).q_ca_id_number;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some(i => i.field === "form_data.q_ca_id_number")).toBe(true);
  });
  it("rejects q_ca_id_type not in allowlist", () => {
    const v = valid(); v.form_data.q_ca_id_type = "Birth Certificate" as any;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some(i => i.field === "form_data.q_ca_id_type")).toBe(true);
  });
  it("accepts each of the 4 allowed ID types", () => {
    for (const t of ["Passport", "National ID", "Driving Licence", "Other"]) {
      const v = valid(); v.form_data.q_ca_id_type = t as any;
      expect(validatePgiSubmissionV2(v).ok).toBe(true);
    }
  });
});

describe("v351 — Boreal $50K loan minimum", () => {
  it("exposes the constant", () => {
    expect(LOAN_AMOUNT_MIN).toBe(50_000);
  });
  it("rejects loan below 50K", () => {
    const v = valid(); v.form_data.q41_loan_amount = 25_000;
    const r = validatePgiSubmissionV2(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some(i => /50,000 minimum/.test(i.message))).toBe(true);
  });
  it("accepts loan at the $50K floor", () => {
    const v = valid(); v.form_data.q41_loan_amount = 50_000; v.form_data.q42_pgi_limit = 25_000;
    expect(validatePgiSubmissionV2(v).ok).toBe(true);
  });
  it("accepts loan at the 1M ceiling", () => {
    const v = valid(); v.form_data.q41_loan_amount = LOAN_AMOUNT_MAX; v.form_data.q42_pgi_limit = 800_000;
    expect(validatePgiSubmissionV2(v).ok).toBe(true);
  });
});
