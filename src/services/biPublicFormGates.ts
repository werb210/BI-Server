// BI_SERVER_BF_REFERRAL_FORM_v283
// Traced from Todd's test on 15 Sep 2026 (BF application d5aa4b1e..., BI public
// id 3b2d0dec...): the BF->BI handoff succeeded, the applicant opened the
// completion form, and every one of ~25 autosaves plus the Submit came back
// 403 "score_not_approved". Nothing typed was saved.
//
// The public form's save, submit and upload routes require a CORE score of
// "approve". Public applicants get that score when they start; applications
// created from a BF referral never run it (BF does not collect EBITDA, debt or
// enterprise value), so score_decision stays empty forever. BF referrals are
// allowed through unless the carrier actually declined them. Staff can still
// run the CORE score from the portal before carrier submission.

export type GateRow = { score_decision?: string | null; source?: string | null };

export function passesScoreGate(row: GateRow): boolean {
  const decision = String(row.score_decision ?? "").toLowerCase();
  if (decision === "approve") return true;
  return row.source === "bf_pgi_referral" && decision !== "decline";
}

const DATE_ONLY_FIELDS = ["guarantor_dob", "formation_date", "loan_funding_date", "policy_start_date"];

/** DATE columns come back as JS Dates and serialise as "1971-04-14T00:00:00.000Z", which a date input cannot show. */
export function withDateOnlyFields<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of DATE_ONLY_FIELDS) {
    const v = out[key];
    if (v instanceof Date && !isNaN(v.getTime())) out[key] = v.toISOString().slice(0, 10);
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) out[key] = v.slice(0, 10);
  }
  return out as T;
}

// BI_SERVER_v789_SUBMIT_GATES - the checks the public submit route runs before
// an application can move on (required fields, consents, Quebec, loan caps,
// loan type). One function, so every path that submits an application
// (public link, legacy /bi/application/submit) applies the same rules.
// Pure: no database access. The caller persists `consents` (the consents with
// info_accurate / business_solvent derived from the declarations) whenever it is
// present, which is as soon as the consent check has passed, even when a later
// gate refuses.

export const PUBLIC_SUBMIT_REQUIRED_FIELDS = [
  "guarantor_name", "guarantor_email", "guarantor_dob", "guarantor_address",
  "guarantor_phone", "business_name", "business_address",
  "lender_name", "loan_funding_date", "policy_start_date",
  "personally_guaranteeing", "consents",
] as const;

export const PUBLIC_SUBMIT_CONSENT_KEYS = [
  "electronic_signature", "info_accurate", "business_solvent",
  "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood",
] as const;

export const ELIGIBLE_LOAN_TYPES = ["Commercial Mortgage", "Other Secured Loan"] as const;
export const SUBMIT_AMOUNT_CAP = 1_000_000;

export type SubmitGateFailure = {
  error:
    | "missing_fields"
    | "missing_consents"
    | "quebec_blocked"
    | "loan_amount_over_cap"
    | "pgi_limit_over_cap"
    | "loan_type_ineligible";
  fields?: string[];
  message?: string;
};

export type SubmitGateResult =
  | { ok: true; consents: Record<string, unknown> }
  | { ok: false; failure: SubmitGateFailure; consents?: Record<string, unknown> };

export function evaluatePublicSubmitGates(app: Record<string, any>): SubmitGateResult {
  // BI_SERVER_BLOCK_v246_BN_OPTIONAL_SUBMIT_v1 - business_number is optional.
  // BI_SERVER_BLOCK_v349_PURBECK_PUBLIC_REQS_v1
  const missing = PUBLIC_SUBMIT_REQUIRED_FIELDS.filter((k) => app[k] === null || app[k] === undefined || app[k] === "");
  if (missing.length) return { ok: false, failure: { error: "missing_fields", fields: [...missing] } };

  // BI_SERVER_BLOCK_v357_CONSENT_DERIVATION_v1 - info_accurate and
  // business_solvent are covered by the declarations (section_3_c truthfulness
  // oath; section_6_a solvency); derive them rather than asking twice.
  const decls = (app.declarations ?? {}) as Record<string, unknown>;
  const c = { ...(app.consents ?? {}) } as Record<string, unknown>;
  if (c.info_accurate === undefined || c.info_accurate === null) {
    c.info_accurate = decls.section_3_c === "Agree";
  }
  if (c.business_solvent === undefined || c.business_solvent === null) {
    c.business_solvent = decls.section_6_a === "yes";
  }
  const unconsented = PUBLIC_SUBMIT_CONSENT_KEYS.filter((k) => !c[k]);
  if (unconsented.length) return { ok: false, failure: { error: "missing_consents", fields: [...unconsented] } };

  // BI_SERVER_BLOCK_v349_PURBECK_GUARDS_v1
  if (typeof app.q_business_province === "string" && app.q_business_province.toUpperCase() === "QC") {
    return { ok: false, consents: c, failure: { error: "quebec_blocked", message: "PGI does not currently write business in Quebec." } };
  }
  if (Number(app.loan_amount) > SUBMIT_AMOUNT_CAP) {
    return { ok: false, consents: c, failure: { error: "loan_amount_over_cap", message: "Loan amount exceeds the 1,000,000 maximum." } };
  }
  if (Number(app.pgi_limit) > SUBMIT_AMOUNT_CAP) {
    return { ok: false, consents: c, failure: { error: "pgi_limit_over_cap", message: "PGI limit exceeds the 1,000,000 maximum." } };
  }
  if (app.q_ca_loan_type && !(ELIGIBLE_LOAN_TYPES as readonly string[]).includes(app.q_ca_loan_type)) {
    return {
      ok: false,
      consents: c,
      failure: {
        error: "loan_type_ineligible",
        message: `Loan type '${app.q_ca_loan_type}' is not eligible for PGI coverage. Eligible types are: ${ELIGIBLE_LOAN_TYPES.join(", ")}.`,
      },
    };
  }
  return { ok: true, consents: c };
}
