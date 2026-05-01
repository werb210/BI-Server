// BI_DOC_LIST_v61
import { describe, it, expect } from "vitest";
import {
  BI_DOC_REQUIREMENTS,
  isStartup,
  requiredSlotsFor,
  carrierBoundSlots,
} from "../biDocumentRequirements";

describe("BI_DOC_LIST_v61 doc requirements", () => {
  it("declares all 8 canonical slots", () => {
    expect(BI_DOC_REQUIREMENTS.map((r) => r.slot).sort()).toEqual([
      "ap_aging", "ar_aging", "balance_sheet",
      "forecast", "founder_cv",
      "gov_id_primary", "gov_id_secondary",
      "pl_12mo",
    ].sort());
  });

  it("KYC slots are NOT carrier-bound", () => {
    const kyc = BI_DOC_REQUIREMENTS.filter((r) => r.slot.startsWith("gov_id"));
    expect(kyc.every((r) => r.carrierBound === false)).toBe(true);
  });

  it("financial slots are carrier-bound", () => {
    const fin = BI_DOC_REQUIREMENTS.filter((r) => !r.slot.startsWith("gov_id"));
    expect(fin.every((r) => r.carrierBound === true)).toBe(true);
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

  it("requiredSlotsFor a mature business excludes startup slots", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const slots = requiredSlotsFor("2019-01-01", now);
    expect(slots).toContain("pl_12mo");
    expect(slots).toContain("gov_id_primary");
    expect(slots).toContain("gov_id_secondary");
    expect(slots).not.toContain("founder_cv");
    expect(slots).not.toContain("forecast");
  });

  it("requiredSlotsFor a startup includes founder_cv and forecast", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const slots = requiredSlotsFor("2025-01-01", now);
    expect(slots).toContain("founder_cv");
    expect(slots).toContain("forecast");
  });

  it("carrierBoundSlots excludes both KYC ID slots", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const slots = carrierBoundSlots("2019-01-01", now);
    expect(slots).not.toContain("gov_id_primary");
    expect(slots).not.toContain("gov_id_secondary");
    // But still includes the four always-required financial docs.
    expect(slots).toContain("pl_12mo");
    expect(slots).toContain("balance_sheet");
    expect(slots).toContain("ar_aging");
    expect(slots).toContain("ap_aging");
  });
});
