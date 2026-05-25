// BI_SERVER_BLOCK_v349_PGI_FIELDS_V2_v1
// Aligned with PGI Partner API Schema Hardening changelog 2026-05-25.
// Documented at https://docs.pgicover.com/api/
//
// New schema (Canadian submissions only — US flow unchanged):
//   - ALL data under form_data; NO top-level fields.
//   - q-prefixed required field names.
//   - 11 declaration sections; adverse answers require matching _reason.
//   - 1M cap on q41_loan_amount AND q42_pgi_limit.
//   - q_ca_loan_type restricted to 2 values.
//   - Quebec hard-blocked (q_business_province !== 'QC').
//
// q_ca_id_type / q_ca_id_number are required by carrier but DEFERRED.
// First submit attempt will return PGI's 400 errors dict naming these fields.
// Acceptable per Todd 2026-05-25 launch-window decision.

export const ALLOWED_COUNTRIES = ["CA", "Canada", "US", "USA"] as const;
export type AllowedCountry = typeof ALLOWED_COUNTRIES[number];

export const ELIGIBLE_LOAN_TYPES = ["Commercial Mortgage", "Other Secured Loan"] as const;
export type EligibleLoanType = typeof ELIGIBLE_LOAN_TYPES[number];

export const CA_PROVINCES_ALLOWED = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "SK", "YT",
] as const;
export type CaProvinceAllowed = typeof CA_PROVINCES_ALLOWED[number];

// BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1
// Loan floor is Boreal-side (Purbeck has no minimum). Todd 2026-05-25.
export const LOAN_AMOUNT_MIN = 50_000;
export const LOAN_AMOUNT_MAX = 1_000_000;
export const PGI_LIMIT_MAX = 1_000_000;

export const PARTNER_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const PARTNER_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/markdown",
]);

export const ADVERSE_YES_SECTIONS = [
  "section_1_2",
  "section_2_a",
  "section_2_b",
  "section_2_c",
  "section_2_d",
  "section_3_a",
  "section_4_a",
  "section_5_a",
] as const;
export type AdverseYesSection = typeof ADVERSE_YES_SECTIONS[number];

export const ALL_DECLARATION_KEYS = [
  "section_1_a",
  "section_1_2",
  "section_2_a",
  "section_2_b",
  "section_2_c",
  "section_2_d",
  "section_3_a",
  "section_3_c",
  "section_4_a",
  "section_5_a",
  "section_6_a",
] as const;
export type DeclarationKey = typeof ALL_DECLARATION_KEYS[number];

// BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1
// q7_email + q_ca_id_type + q_ca_id_number promoted to REQUIRED per corrected
// changelog 2026-05-25. No longer deferred.
export type PgiFormDataV2 = {
  q0_country: AllowedCountry;
  q2_full_name: string;
  q4_date_of_birth: string;
  q7_email: string;
  q5_residential_address: string | Record<string, string>;
  q_ca_id_type: string;
  q_ca_id_number: string;
  q15_business_legal_name: string;
  q17_business_operating_address: string | Record<string, string>;
  q_business_province?: CaProvinceAllowed;
  q25_naics_code: string;
  q26_formation_date: string;
  q_ca_loan_type: EligibleLoanType;
  q41_loan_amount: number;
  q42_pgi_limit: number;
  section_1_a: "yes" | "no";
  section_1_2: "yes" | "no";
  section_2_a: "yes" | "no";
  section_2_b: "yes" | "no";
  section_2_c: "yes" | "no";
  section_2_d: "yes" | "no";
  section_3_a: "yes" | "no";
  section_3_c: "Agree" | "Disagree";
  section_4_a: "yes" | "no";
  section_5_a: "yes" | "no";
  section_6_a: "yes" | "no";
  section_1_2_reason?: string;
  section_2_a_reason?: string;
  section_2_b_reason?: string;
  section_2_c_reason?: string;
  section_2_d_reason?: string;
  section_3_a_reason?: string;
  section_3_c_reason?: string;
  section_4_a_reason?: string;
  section_5_a_reason?: string;
};

export type PgiSubmissionV2 = { form_data: PgiFormDataV2 };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAICS_RE = /^\d{6}$/;
export type ValidationIssue = { field: string; message: string };

function isNonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function isAddress(v: unknown): boolean {
  if (isNonEmptyString(v)) return true;
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return isNonEmptyString(r.line1) || isNonEmptyString(r.city);
  }
  return false;
}
function detectQuebecFromAddress(v: unknown): boolean {
  if (isNonEmptyString(v)) return /\b(QC|Quebec|Qu[eé]bec)\b/i.test(v);
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return ((isNonEmptyString(r.state) && /^QC$/i.test(r.state)) || (isNonEmptyString(r.province) && /^QC$/i.test(r.province)));
  }
  return false;
}

export function validatePgiSubmissionV2(input: unknown): { ok: true; value: PgiSubmissionV2 } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const s = (input ?? {}) as Record<string, unknown>;
  const fd = (s.form_data ?? {}) as Record<string, unknown>;

  if (typeof fd.q0_country !== "string" || !(ALLOWED_COUNTRIES as readonly string[]).includes(fd.q0_country)) issues.push({ field: "form_data.q0_country", message: `must be one of ${ALLOWED_COUNTRIES.join(", ")}` });
  if (!isNonEmptyString(fd.q2_full_name)) issues.push({ field: "form_data.q2_full_name", message: "required" });
  if (!isNonEmptyString(fd.q4_date_of_birth) || !ISO_DATE_RE.test(fd.q4_date_of_birth as string)) issues.push({ field: "form_data.q4_date_of_birth", message: "must be YYYY-MM-DD" });
  // BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1 — q7_email is now a required carrier field.
  if (!isNonEmptyString(fd.q7_email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.q7_email as string)) issues.push({ field: "form_data.q7_email", message: "valid email required" });
  if (!isAddress(fd.q5_residential_address)) issues.push({ field: "form_data.q5_residential_address", message: "required" });
  // BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1 — Government ID required (Craig confirmed in corrected changelog).
  const ALLOWED_ID_TYPES = ["Passport", "National ID", "Driving Licence", "Other"];
  if (!isNonEmptyString(fd.q_ca_id_type)) issues.push({ field: "form_data.q_ca_id_type", message: "required" });
  else if (!ALLOWED_ID_TYPES.includes(fd.q_ca_id_type as string)) issues.push({ field: "form_data.q_ca_id_type", message: `must be one of ${ALLOWED_ID_TYPES.join(", ")}` });
  if (!isNonEmptyString(fd.q_ca_id_number)) issues.push({ field: "form_data.q_ca_id_number", message: "required" });
  if (!isNonEmptyString(fd.q15_business_legal_name)) issues.push({ field: "form_data.q15_business_legal_name", message: "required" });
  if (!isAddress(fd.q17_business_operating_address)) issues.push({ field: "form_data.q17_business_operating_address", message: "required" });
  if (typeof fd.q25_naics_code !== "string" || !NAICS_RE.test(fd.q25_naics_code)) issues.push({ field: "form_data.q25_naics_code", message: "must be a 6-digit NAICS code" });
  if (!isNonEmptyString(fd.q26_formation_date) || !ISO_DATE_RE.test(fd.q26_formation_date as string)) issues.push({ field: "form_data.q26_formation_date", message: "must be YYYY-MM-DD" });

  if (typeof fd.q_business_province === "string" && /^QC$/i.test(fd.q_business_province)) issues.push({ field: "form_data.q_business_province", message: "PGI does not currently write business in Quebec." });
  if (detectQuebecFromAddress(fd.q17_business_operating_address)) issues.push({ field: "form_data.q17_business_operating_address", message: "PGI does not currently write business in Quebec." });
  if (detectQuebecFromAddress(fd.q5_residential_address)) issues.push({ field: "form_data.q5_residential_address", message: "PGI does not currently write business in Quebec." });

  if (typeof fd.q_ca_loan_type !== "string" || !(ELIGIBLE_LOAN_TYPES as readonly string[]).includes(fd.q_ca_loan_type)) issues.push({ field: "form_data.q_ca_loan_type", message: `must be one of ${ELIGIBLE_LOAN_TYPES.join(", ")}` });

  // BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1 — Boreal-side $50K floor added.
  const loan = Number(fd.q41_loan_amount);
  if (!Number.isFinite(loan) || loan <= 0) issues.push({ field: "form_data.q41_loan_amount", message: "must be > 0" });
  else if (loan < LOAN_AMOUNT_MIN) issues.push({ field: "form_data.q41_loan_amount", message: `Loan amount ${loan} is below the 50,000 minimum.` });
  else if (loan > LOAN_AMOUNT_MAX) issues.push({ field: "form_data.q41_loan_amount", message: `Loan amount ${loan} exceeds the 1,000,000 maximum.` });

  const limit = Number(fd.q42_pgi_limit);
  if (!Number.isFinite(limit) || limit <= 0) issues.push({ field: "form_data.q42_pgi_limit", message: "must be > 0" });
  else if (limit > PGI_LIMIT_MAX) issues.push({ field: "form_data.q42_pgi_limit", message: `PGI limit ${limit} exceeds the 1,000,000 maximum.` });
  else if (Number.isFinite(loan) && limit > loan) issues.push({ field: "form_data.q42_pgi_limit", message: "pgi_limit cannot exceed loan_amount" });

  for (const key of ALL_DECLARATION_KEYS) {
    const v = fd[key];
    if (key === "section_3_c") {
      if (v !== "Agree" && v !== "Disagree") issues.push({ field: `form_data.${key}`, message: "must be 'Agree' or 'Disagree'" });
      if (v === "Disagree" && !isNonEmptyString(fd.section_3_c_reason)) issues.push({ field: "form_data.section_3_c_reason", message: "A reason is required when 'section_3_c' is answered adversely." });
    } else {
      if (v !== "yes" && v !== "no") issues.push({ field: `form_data.${key}`, message: "must be 'yes' or 'no'" });
      if ((ADVERSE_YES_SECTIONS as readonly string[]).includes(key) && v === "yes") {
        const reasonKey = `${key}_reason`;
        if (!isNonEmptyString(fd[reasonKey])) issues.push({ field: `form_data.${reasonKey}`, message: `A reason is required when '${key}' is answered adversely.` });
      }
    }
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { form_data: fd as unknown as PgiFormDataV2 } };
}

export function isPartnerAllowedMime(mime: string): boolean { return PARTNER_ALLOWED_MIME.has(mime); }
export function isPartnerWithinSize(bytes: number): boolean { return bytes > 0 && bytes <= PARTNER_MAX_FILE_BYTES; }

// Legacy export kept for existing routes/tests compatibility.
export function validatePgiSubmission(input: unknown): { ok: true; value: any } | { ok: false; issues: ValidationIssue[] } {
  const x = (input ?? {}) as Record<string, unknown>;
  const fd = (x.form_data ?? {}) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  if (!isNonEmptyString(x.guarantor_name)) issues.push({ field: "guarantor_name", message: "required" });
  if (!isNonEmptyString(x.guarantor_email)) issues.push({ field: "guarantor_email", message: "required" });
  if (!isNonEmptyString(x.business_name)) issues.push({ field: "business_name", message: "required" });
  if (typeof fd.country !== "string") issues.push({ field: "form_data.country", message: "required" });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: x };
}
