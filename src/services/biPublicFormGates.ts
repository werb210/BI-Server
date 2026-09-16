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
