// BI_DOC_LIST_v61 — canonical Boreal Insurance document requirements.
// Source: PGI carrier email, 1 May 2026.

export type BiDocSlot =
  | "pl_12mo"
  | "balance_sheet"
  | "ar_aging"
  | "ap_aging"
  | "founder_cv"
  | "forecast"
  | "gov_id_primary"
  | "gov_id_secondary";

export type BiDocRequirement = {
  slot: BiDocSlot;
  label: string;
  description: string;
  /** Whether this doc is forwarded to PGI (true) or kept BI-internal for KYC (false). */
  carrierBound: boolean;
  /** Always required, or only when applicant is a startup (<3 years old). */
  conditional: "always" | "startup_only";
};

export const BI_DOC_REQUIREMENTS: readonly BiDocRequirement[] = [
  {
    slot: "pl_12mo",
    label: "Profit & Loss — last 12 months",
    description: "Monthly breakdown for the last 12 months",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "balance_sheet",
    label: "Balance Sheet — most recent month-end",
    description: "End of last completed month",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "ar_aging",
    label: "Accounts Receivable Aging — most recent",
    description: "End of last completed month",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "ap_aging",
    label: "Accounts Payable Aging — most recent",
    description: "End of last completed month",
    carrierBound: true,
    conditional: "always",
  },
  {
    slot: "founder_cv",
    label: "Founder CV(s)",
    description: "CVs of all founders — required for businesses under 3 years old",
    carrierBound: true,
    conditional: "startup_only",
  },
  {
    slot: "forecast",
    label: "Financial forecasts",
    description: "Forecasts supporting the loan — required for businesses under 3 years old",
    carrierBound: true,
    conditional: "startup_only",
  },
  {
    slot: "gov_id_primary",
    label: "Government Photo ID — Driver's Licence",
    description: "Valid, unexpired. Boreal-internal KYC.",
    carrierBound: false,
    conditional: "always",
  },
  {
    slot: "gov_id_secondary",
    label: "Government Photo ID — Passport (preferred) or other",
    description: "Second piece of government-issued photo ID. Passport preferred. Boreal-internal KYC.",
    carrierBound: false,
    conditional: "always",
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
 * Returns false on a missing or unparseable date — the form-level validator
 * is responsible for rejecting bad dates before this is called.
 */
export function isStartup(formationDateIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!formationDateIso) return false;
  const d = new Date(formationDateIso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  return d.getTime() > cutoff.getTime();
}

/** The currently-required slots given a formation_date. */
export function requiredSlotsFor(formationDateIso: string | null | undefined, now: Date = new Date()): BiDocSlot[] {
  const startup = isStartup(formationDateIso, now);
  return BI_DOC_REQUIREMENTS
    .filter((r) => r.conditional === "always" || (r.conditional === "startup_only" && startup))
    .map((r) => r.slot);
}

/** Subset of slots that get forwarded to the PGI carrier doc upload endpoint. */
export function carrierBoundSlots(formationDateIso: string | null | undefined, now: Date = new Date()): BiDocSlot[] {
  return requiredSlotsFor(formationDateIso, now).filter((s) => SLOT_BY_KEY[s].carrierBound);
}
