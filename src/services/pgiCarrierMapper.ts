// PGI_API_ALIGN_v57 — strict 18-field carrier payload mapper.
// Carrier contract: docs.pgicover.com — POST /applications/.
//
// Whatever shape an application row carries internally (extra metadata, BI-only
// fields, persisted experiments), this mapper guarantees the outbound HTTP body
// to PGI contains EXACTLY the 17 required fields plus the 1 optional one — and
// nothing else. This is the single point of truth for what crosses the wire.

import type { PgiSubmission, PgiFormData, AllowedCountry } from "../lib/validation/pgiFields";

export type CarrierPayload = PgiSubmission;

type AnyRecord = Record<string, unknown>;

function pickFormData(input: AnyRecord): PgiFormData {
  return {
    country: input.country as AllowedCountry,
    naics_code: input.naics_code as string,
    formation_date: input.formation_date as string,
    loan_amount: input.loan_amount as number,
    pgi_limit: input.pgi_limit as number,
    annual_revenue: input.annual_revenue as number,
    ebitda: input.ebitda as number,
    total_debt: input.total_debt as number,
    monthly_debt_service: input.monthly_debt_service as number,
    collateral_value: input.collateral_value as number,
    enterprise_value: input.enterprise_value as number,
    bankruptcy_history: input.bankruptcy_history as boolean,
    insolvency_history: input.insolvency_history as boolean,
    judgment_history: input.judgment_history as boolean,
  };
}

export function buildCarrierPayload(top: AnyRecord, formData: AnyRecord): CarrierPayload {
  const payload: CarrierPayload = {
    guarantor_name: top.guarantor_name as string,
    guarantor_email: top.guarantor_email as string,
    business_name: top.business_name as string,
    form_data: pickFormData(formData),
  };
  if (typeof top.lender_name === "string" && top.lender_name.trim().length > 0) {
    payload.lender_name = top.lender_name;
  }
  return payload;
}

export function buildCarrierPayloadFromRow(row: {
  guarantor_name: string;
  guarantor_email: string;
  lender_name: string | null;
  data: AnyRecord;
}): CarrierPayload {
  const data = row.data || {};
  const top: AnyRecord = {
    guarantor_name: row.guarantor_name,
    guarantor_email: row.guarantor_email,
    business_name: data.business_name,
    lender_name: row.lender_name ?? data.lender_name ?? undefined,
  };
  return buildCarrierPayload(top, data);
}
