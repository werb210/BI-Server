// BI_SERVER_BLOCK_v349_PURBECK_ALIGNMENT_v1
import { describe, it, expect } from "vitest";
import { validatePgiSubmissionV2, ELIGIBLE_LOAN_TYPES, LOAN_AMOUNT_MAX, PARTNER_MAX_FILE_BYTES, isPartnerAllowedMime, isPartnerWithinSize } from "../pgiFields";

function valid() { return { form_data: { q0_country: "Canada", q2_full_name: "Sarah Chen", q4_date_of_birth: "1985-06-15", q7_email: "sarah.chen@example.com", q5_residential_address: "456 Oak Avenue, Toronto, ON M4V 2P7, Canada", q_ca_id_type: "Driving Licence", q_ca_id_number: "DL123456789", q15_business_legal_name: "Maple Leaf Technologies Inc.", q17_business_operating_address: "789 King Street West, Toronto, ON M5H 2A9, Canada", q_business_province: "ON", q25_naics_code: "541511", q26_formation_date: "2019-03-15", q_ca_loan_type: "Commercial Mortgage", q41_loan_amount: 500000, q42_pgi_limit: 250000, section_1_a: "yes", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "yes" } }; }

describe("validatePgiSubmissionV2 — Purbeck-aligned schema", () => {
  it("accepts a complete valid Canadian submission", () => { expect(validatePgiSubmissionV2(valid()).ok).toBe(true); });
  it("rejects missing q2_full_name", () => { const v=valid(); v.form_data.q2_full_name=""; const r=validatePgiSubmissionV2(v); expect(r.ok).toBe(false); });
  it("rejects Quebec province", () => { const v=valid(); (v.form_data as any).q_business_province="QC"; const r=validatePgiSubmissionV2(v); expect(r.ok).toBe(false); });
  it("rejects Quebec address even when province absent", () => { const v=valid(); delete (v.form_data as any).q_business_province; v.form_data.q17_business_operating_address="5678 Avenue McGill, Montreal, QC H3A 1W9, Canada"; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("rejects ineligible loan type", () => { const v=valid(); (v.form_data as any).q_ca_loan_type="Asset Finance"; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("accepts both eligible loan types", () => { for (const t of ELIGIBLE_LOAN_TYPES) { const v=valid(); (v.form_data as any).q_ca_loan_type=t; expect(validatePgiSubmissionV2(v).ok).toBe(true); } });
  it("rejects loan_amount above 1M cap", () => { const v=valid(); v.form_data.q41_loan_amount=LOAN_AMOUNT_MAX+1; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("rejects pgi_limit above 1M cap", () => { const v=valid(); v.form_data.q42_pgi_limit=1500000; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("rejects pgi_limit > loan_amount", () => { const v=valid(); v.form_data.q41_loan_amount=100000; v.form_data.q42_pgi_limit=200000; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("requires reason when section_1_2 is yes", () => { const v=valid(); v.form_data.section_1_2="yes"; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("accepts section_1_2 yes when reason provided", () => { const v=valid(); v.form_data.section_1_2="yes"; (v.form_data as any).section_1_2_reason="x"; expect(validatePgiSubmissionV2(v).ok).toBe(true); });
  it("requires reason when section_3_c is Disagree", () => { const v=valid(); v.form_data.section_3_c="Disagree"; expect(validatePgiSubmissionV2(v).ok).toBe(false); });
  it("does not require a reason for non-adverse consent sections", () => { expect(validatePgiSubmissionV2(valid()).ok).toBe(true); });
});

describe("partner document constraints", () => {
  it("allows PDF/DOCX/XLSX/CSV/MD", () => { expect(isPartnerAllowedMime("application/pdf")).toBe(true); expect(isPartnerAllowedMime("text/csv")).toBe(true); });
  it("rejects images", () => { expect(isPartnerAllowedMime("image/jpeg")).toBe(false); });
  it("enforces 5MB cap", () => { expect(isPartnerWithinSize(PARTNER_MAX_FILE_BYTES)).toBe(true); expect(isPartnerWithinSize(PARTNER_MAX_FILE_BYTES + 1)).toBe(false); });
});
