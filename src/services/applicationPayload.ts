// BI_INDUSTRY_ROUTING_v31
// The carrier mapper reads bi_applications.data, while the client flow writes
// to bi_application_answers. Project the carrier-relevant answers onto data.
export type AnswerRow = { question_key: string; value: string | null };

const KEEP = new Set([
  "guarantor_dob", "q_ca_id_type", "q_ca_id_number", "has_co_guarantors",
  "entity_type", "business_number", "business_website", "formation_date", "naics_code",
  "lender_name", "q_ca_loan_type", "loan_amount", "pgi_limit", "loan_funding_date",
  "policy_start_date", "loan_purpose", "csbfp_backed", "sba_backed",
  "loan_has_guaranteed_cap", "personally_guaranteeing",
]);

function join(parts: (string | undefined)[]): string {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(", ");
}

export function projectAnswersToData(answers: AnswerRow[]): Record<string, unknown> {
  const byKey = new Map<string, string>();
  for (const row of answers) {
    const value = String(row?.value ?? "").trim();
    if (value) byKey.set(row.question_key, value);
  }

  const out: Record<string, unknown> = {};
  for (const key of KEEP) {
    const value = byKey.get(key);
    if (value !== undefined) out[key] = value;
  }

  const guarantor = join([
    byKey.get("guarantor_addr_line1"), byKey.get("guarantor_addr_city"),
    byKey.get("guarantor_addr_region"), byKey.get("guarantor_addr_postal"),
  ]);
  if (guarantor) out.guarantor_address = guarantor;

  const business = join([
    byKey.get("business_addr_line1"), byKey.get("business_addr_city"),
    byKey.get("business_addr_region"), byKey.get("business_addr_postal"),
  ]);
  if (business) out.business_address = business;

  return out;
}
