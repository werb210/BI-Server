import { describe, it, expect } from "vitest";
import { validatePgiSubmission } from "../pgiFields";

const VALID = {
  guarantor_name: "Sarah Chen",
  guarantor_email: "sarah@example.com",
  business_name: "Maple Leaf Tech Inc.",
  lender_name: "RBC",
  form_data: {
    country: "CA", naics_code: "541511", formation_date: "2019-03-15",
    loan_amount: 500000, pgi_limit: 250000, annual_revenue: 2000000,
    ebitda: 400000, total_debt: 300000, monthly_debt_service: 8000,
    collateral_value: 600000, enterprise_value: 3000000,
    bankruptcy_history: false, insolvency_history: false, judgment_history: false,
  },
};

describe("PGI_API_ALIGN_v57 validator", () => {
  it("accepts a fully valid 17+1 submission", () => {
    expect(validatePgiSubmission(VALID).ok).toBe(true);
  });
  it("accepts submission without optional lender_name", () => {
    const { lender_name: _l, ...rest } = VALID;
    void _l;
    expect(validatePgiSubmission(rest).ok).toBe(true);
  });
  it("rejects pgi_limit > loan_amount", () => {
    const r = validatePgiSubmission({ ...VALID, form_data: { ...VALID.form_data, pgi_limit: 600000 } });
    expect(r.ok).toBe(false);
  });
  it("rejects unsupported country", () => {
    const r = validatePgiSubmission({ ...VALID, form_data: { ...VALID.form_data, country: "MX" } });
    expect(r.ok).toBe(false);
  });
  it("rejects non-6-digit NAICS", () => {
    const r = validatePgiSubmission({ ...VALID, form_data: { ...VALID.form_data, naics_code: "54151" } });
    expect(r.ok).toBe(false);
  });
  it("allows negative ebitda", () => {
    const r = validatePgiSubmission({ ...VALID, form_data: { ...VALID.form_data, ebitda: -50000 } });
    expect(r.ok).toBe(true);
  });
  it("rejects non-ISO formation_date", () => {
    const r = validatePgiSubmission({ ...VALID, form_data: { ...VALID.form_data, formation_date: "March 15, 2019" } });
    expect(r.ok).toBe(false);
  });
  it("rejects when boolean disclosures are missing", () => {
    const fd = { ...VALID.form_data } as Record<string, unknown>;
    delete fd.bankruptcy_history;
    const r = validatePgiSubmission({ ...VALID, form_data: fd });
    expect(r.ok).toBe(false);
  });
});
