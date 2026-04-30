import { describe, it, expect } from "vitest";
import { buildCarrierPayload, buildCarrierPayloadFromRow } from "../pgiCarrierMapper";

const TOP = {
  guarantor_name: "Sarah Chen",
  guarantor_email: "sarah@example.com",
  business_name: "Maple Leaf Tech Inc.",
  lender_name: "RBC",
};
const FORM_DATA = {
  country: "CA", naics_code: "541511", formation_date: "2019-03-15",
  loan_amount: 500000, pgi_limit: 250000, annual_revenue: 2000000,
  ebitda: 400000, total_debt: 300000, monthly_debt_service: 8000,
  collateral_value: 600000, enterprise_value: 3000000,
  bankruptcy_history: false, insolvency_history: false, judgment_history: false,
};

describe("PGI_API_ALIGN_v57 carrier payload mapper", () => {
  it("emits exactly 4 top-level keys + form_data", () => {
    const p = buildCarrierPayload(TOP, FORM_DATA);
    expect(Object.keys(p).sort()).toEqual(["business_name", "form_data", "guarantor_email", "guarantor_name", "lender_name"].sort());
  });

  it("emits exactly 14 form_data keys", () => {
    const p = buildCarrierPayload(TOP, FORM_DATA);
    expect(Object.keys(p.form_data).length).toBe(14);
  });

  it("strips extra fields from the top level (e.g. internal ids, metadata)", () => {
    const p = buildCarrierPayload({ ...TOP, internal_id: "x-123", source_type: "lender", silo: "BI" }, FORM_DATA);
    expect((p as unknown as Record<string, unknown>).internal_id).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).source_type).toBeUndefined();
    expect((p as unknown as Record<string, unknown>).silo).toBeUndefined();
  });

  it("strips extra fields from form_data (e.g. address, dob, ssn)", () => {
    const noisy = { ...FORM_DATA, business_address: "123 Main", guarantor_dob: "1985-06-01", guarantor_ssn: "123-45-6789", industry_description: "tech" };
    const p = buildCarrierPayload(TOP, noisy);
    const keys = Object.keys(p.form_data);
    expect(keys).not.toContain("business_address");
    expect(keys).not.toContain("guarantor_dob");
    expect(keys).not.toContain("guarantor_ssn");
    expect(keys).not.toContain("industry_description");
  });

  it("omits lender_name when blank or absent", () => {
    const p1 = buildCarrierPayload({ ...TOP, lender_name: "" }, FORM_DATA);
    expect((p1 as unknown as Record<string, unknown>).lender_name).toBeUndefined();

    const { lender_name: _ln, ...noLender } = TOP;
    void _ln;
    const p2 = buildCarrierPayload(noLender, FORM_DATA);
    expect((p2 as unknown as Record<string, unknown>).lender_name).toBeUndefined();
  });

  it("buildCarrierPayloadFromRow maps a bi_applications row correctly", () => {
    const row = {
      guarantor_name: "Sarah Chen",
      guarantor_email: "sarah@example.com",
      lender_name: "RBC",
      data: { ...FORM_DATA, business_name: "Maple Leaf Tech Inc.", junk: "should-not-leak" },
    };
    const p = buildCarrierPayloadFromRow(row);
    expect(p.business_name).toBe("Maple Leaf Tech Inc.");
    expect(p.lender_name).toBe("RBC");
    expect((p.form_data as unknown as Record<string, unknown>).junk).toBeUndefined();
  });
});
