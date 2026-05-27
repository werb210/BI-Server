// BI_SERVER_BLOCK_v379_TEST1_FIX_PACK_v1 — canonical doc list.
// Source of truth: PGI carrier intake page at
// app.pgicover.com/applications/new/upload?from=score (operator
// screenshot 2026-05-26 6.58.58 PM). Five always-required + two
// startup-only (businesses <3 years old). Boreal-internal KYC docs
// (gov_id_primary/secondary from BI_DOC_LIST_v61) are no longer in
// this list — they were never collected through the public or
// lender forms and were the cause of false DOCS_NOT_READY responses
// in the staff send-to-carrier path.
//
// Slot names match the doc_type vocabulary (bi_document_type enum
// values that biPublicApplicationRoutes.ts and biLenderApplicationCreate.ts
// already use for uploads). This collapses the parallel doc_type vs
// doc_slot vocabularies that BI_DOC_LIST_v61 maintained.

export type BiDocSlot =
  | "loan_agreement"
  | "profit_loss"
  | "balance_sheet"
  | "ar_aging"
  | "ap_aging"
  | "founder_cv"
  | "financial_forecast";

export type BiDocRequirement = {
  slot: BiDocSlot;
  label: string;
  description: string;
  /** Whether this doc is forwarded to PGI (true) or kept BI-internal (false). */
  carrierBound: boolean;
  /** Always required, or only when applicant is a startup (<3 years old). */
  conditional: "always" | "startup_only";
};

export const BI_DOC_REQUIREMENTS: readonly BiDocRequirement[] = [
  {
    slot: "loan_agreement",
    label: "Lender Agreement / Term Sheet",
    description: "Upload the lender's agreement or term sheet for the loan being insured.",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "profit_loss",
    label: "Profit & Loss Statement",
    description: "Last 12 months, monthly breakdown.",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "balance_sheet",
    label: "Balance Sheet",
    description: "Most recent month-end.",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "ar_aging",
    label: "Accounts Receivable Aging Summary",
    description: "Most recent.",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "ap_aging",
    label: "Accounts Payable Aging Summary",
    description: "Most recent.",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "founder_cv",
    label: "Founder CV(s)",
    description: "Required for businesses under 3 years old.",
    carrierBound: true,
    conditional: "startup_only",
  },
  {
    slot: "financial_forecast",
    label: "Financial Forecast",
    description: "Required for businesses under 3 years old.",
    carrierBound: true,
    conditional: "startup_only",
  },
] as const;

const SLOT_BY_KEY = (() => {
  const m = {} as Record<BiDocSlot, BiDocRequirement>;
  for (const r of BI_DOC_REQUIREMENTS) m[r.slot] = r;
  return m;
})();

export function biDocSlot(slot: BiDocSlot | string): BiDocRequirement | undefined {
  return SLOT_BY_KEY[slot as BiDocSlot];
}

/**
 * Strict 3-year cutoff. Startup if formation_date is within the last 3 years.
 * Returns false on a missing or unparseable date — form-layer validators reject
 * bad dates before this is called.
 */
export function isStartup(formationDateIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!formationDateIso) return false;
  const d = new Date(formationDateIso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  return d.getTime() > cutoff.getTime();
}

export function requiredSlotsFor(formationDateIso: string | null | undefined, now: Date = new Date()): BiDocSlot[] {
  const startup = isStartup(formationDateIso, now);
  return BI_DOC_REQUIREMENTS
    .filter((r) => r.conditional === "always" || (r.conditional === "startup_only" && startup))
    .map((r) => r.slot);
}

/** Subset of required slots that get forwarded to the PGI carrier. */
export function carrierBoundSlots(formationDateIso: string | null | undefined, now: Date = new Date()): BiDocSlot[] {
  return requiredSlotsFor(formationDateIso, now).filter((s) => SLOT_BY_KEY[s].carrierBound);
}
