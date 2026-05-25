// BI_SERVER_BLOCK_v349_CARRIER_MAPPER_V2_v1
import type { PgiFormDataV2, PgiSubmissionV2, DeclarationKey } from "../lib/validation/pgiFields";
import { ALL_DECLARATION_KEYS, ADVERSE_YES_SECTIONS } from "../lib/validation/pgiFields";

export type CarrierPayloadV2 = PgiSubmissionV2;
type AnyRecord = Record<string, unknown>;

function s(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }
function n(v: unknown): number { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : 0; }
function ynOrUndefined(v: unknown): "yes" | "no" | undefined {
  if (v === "yes" || v === true || v === "true" || v === 1 || v === "1") return "yes";
  if (v === "no" || v === false || v === "false" || v === 0 || v === "0") return "no";
}

export function buildCarrierPayloadV2(row: AnyRecord, data: AnyRecord, declarations: AnyRecord): CarrierPayloadV2 {
  const get = (qKey: string, legacyKey?: string): unknown => {
    if (row[qKey] != null && row[qKey] !== "") return row[qKey];
    if (data[qKey] != null && data[qKey] !== "") return data[qKey];
    if (legacyKey && row[legacyKey] != null && row[legacyKey] !== "") return row[legacyKey];
    if (legacyKey && data[legacyKey] != null && data[legacyKey] !== "") return data[legacyKey];
    return undefined;
  };

  const country = s(get("q0_country", "country")) || "Canada";
  const formation = s(get("q26_formation_date", "formation_date"));
  const dob = s(get("q4_date_of_birth", "guarantor_dob"));

  const fd: PgiFormDataV2 = {
    q0_country: country as PgiFormDataV2["q0_country"],
    q2_full_name: s(get("q2_full_name", "guarantor_name")),
    q4_date_of_birth: dob.length >= 10 ? dob.slice(0, 10) : dob,
    q5_residential_address: s(get("q5_residential_address", "guarantor_address")),
    q15_business_legal_name: s(get("q15_business_legal_name", "business_name")),
    q17_business_operating_address: s(get("q17_business_operating_address", "business_address")),
    q25_naics_code: s(get("q25_naics_code", "naics_code")),
    q26_formation_date: formation.length >= 10 ? formation.slice(0, 10) : formation,
    q_ca_loan_type: s(get("q_ca_loan_type")) as PgiFormDataV2["q_ca_loan_type"],
    q41_loan_amount: n(get("q41_loan_amount", "loan_amount")),
    q42_pgi_limit: n(get("q42_pgi_limit", "pgi_limit")),
    section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no",
  };
  const province = s(get("q_business_province", "business_province"));
  if (province) (fd as AnyRecord).q_business_province = province;
  const idType = s(get("q_ca_id_type")); if (idType) (fd as AnyRecord).q_ca_id_type = idType;
  const idNumber = s(get("q_ca_id_number")); if (idNumber) (fd as AnyRecord).q_ca_id_number = idNumber;

  for (const key of ALL_DECLARATION_KEYS as readonly DeclarationKey[]) {
    const raw = declarations[key];
    if (key === "section_3_c") {
      const v = raw === "Disagree" ? "Disagree" : "Agree";
      (fd as AnyRecord).section_3_c = v;
      if (v === "Disagree") { const reason = s(declarations.section_3_c_reason); if (reason) (fd as AnyRecord).section_3_c_reason = reason; }
    } else {
      const v = ynOrUndefined(raw) ?? "no";
      (fd as AnyRecord)[key] = v;
      if ((ADVERSE_YES_SECTIONS as readonly string[]).includes(key) && v === "yes") {
        const rk = `${key}_reason`; const reason = s(declarations[rk]); if (reason) (fd as AnyRecord)[rk] = reason;
      }
    }
  }
  return { form_data: fd };
}

// Legacy mappers retained for existing PGI v1 callers/tests.
export function buildCarrierPayload(top: AnyRecord, formData: AnyRecord): AnyRecord {
  const out: AnyRecord = {
    guarantor_name: s(top.guarantor_name),
    guarantor_email: s(top.guarantor_email),
    business_name: s(top.business_name),
    form_data: {
      country: s(formData.country),
      naics_code: s(formData.naics_code),
      formation_date: s(formData.formation_date),
      loan_amount: n(formData.loan_amount),
      pgi_limit: n(formData.pgi_limit),
      annual_revenue: n(formData.annual_revenue),
      ebitda: n(formData.ebitda),
      total_debt: n(formData.total_debt),
      monthly_debt_service: n(formData.monthly_debt_service),
      collateral_value: n(formData.collateral_value),
      enterprise_value: n(formData.enterprise_value),
      bankruptcy_history: Boolean(formData.bankruptcy_history),
      insolvency_history: Boolean(formData.insolvency_history),
      judgment_history: Boolean(formData.judgment_history),
    },
  };
  if (s(top.lender_name)) out.lender_name = s(top.lender_name);
  return out;
}

export function buildCarrierPayloadFromRow(row: AnyRecord): AnyRecord {
  const data = (row.data ?? {}) as AnyRecord;
  return buildCarrierPayload(
    { guarantor_name: row.guarantor_name, guarantor_email: row.guarantor_email, business_name: data.business_name ?? row.business_name, lender_name: row.lender_name },
    data,
  );
}
