// BI_SERVER_BLOCK_v379_TEST1_FIX_PACK_v1 — canonical doc list assertions.
// Replaces BI_DOC_LIST_v61 test which asserted an 8-slot list using
// doc_slot vocabulary (pl_12mo, gov_id_primary, etc.).
import { describe, it, expect } from "vitest";
import {
  BI_DOC_REQUIREMENTS,
  isStartup,
  requiredSlotsFor,
  carrierBoundSlots,
} from "../biDocumentRequirements";

describe("BI_SERVER_BLOCK_v379 doc requirements", () => {
  it("declares the canonical 7 slots in doc_type vocabulary", () => {
    expect(BI_DOC_REQUIREMENTS.map((r) => r.slot).sort()).toEqual([
      "ap_aging",
      "ar_aging",
      "balance_sheet",
      "financial_forecast",
      "founder_cv",
      "loan_agreement",
      "profit_loss",
    ]);
  });

  it("all canonical slots are carrier-bound", () => {
    expect(BI_DOC_REQUIREMENTS.every((r) => r.carrierBound === true)).toBe(true);
  });

  it("5 slots are always-required; 2 are startup-only", () => {
    const always = BI_DOC_REQUIREMENTS.filter((r) => r.conditional === "always").map((r) => r.slot).sort();
    const startup = BI_DOC_REQUIREMENTS.filter((r) => r.conditional === "startup_only").map((r) => r.slot).sort();
    expect(always).toEqual(["ap_aging", "ar_aging", "balance_sheet", "loan_agreement", "profit_loss"]);
    expect(startup).toEqual(["financial_forecast", "founder_cv"]);
  });

  it("isStartup is true for formation_date 1 year ago", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(isStartup("2025-05-01", now)).toBe(true);
  });

  it("isStartup is true for formation_date exactly 2 years 364 days ago", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(isStartup("2023-05-02", now)).toBe(true);
  });

  it("isStartup is false for formation_date exactly 3 years ago", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(isStartup("2023-05-01", now)).toBe(false);
  });

  it("isStartup is false for formation_date 5 years ago", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(isStartup("2021-05-01", now)).toBe(false);
  });

  it("isStartup is false for missing or invalid date", () => {
    expect(isStartup(null)).toBe(false);
    expect(isStartup(undefined)).toBe(false);
    expect(isStartup("not-a-date")).toBe(false);
  });

  it("requiredSlotsFor a mature business returns the canonical 5", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const slots = requiredSlotsFor("2019-01-01", now).sort();
    expect(slots).toEqual(["ap_aging", "ar_aging", "balance_sheet", "loan_agreement", "profit_loss"]);
  });

  it("requiredSlotsFor a startup adds founder_cv and financial_forecast", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const slots = requiredSlotsFor("2025-01-01", now);
    expect(slots).toContain("founder_cv");
    expect(slots).toContain("financial_forecast");
    expect(slots).toContain("loan_agreement");
    expect(slots).toContain("profit_loss");
    expect(slots).toHaveLength(7);
  });

  it("carrierBoundSlots equals requiredSlotsFor (all canonical slots are carrier-bound)", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(carrierBoundSlots("2019-01-01", now).sort()).toEqual(requiredSlotsFor("2019-01-01", now).sort());
    expect(carrierBoundSlots("2025-01-01", now).sort()).toEqual(requiredSlotsFor("2025-01-01", now).sort());
  });
});
