// BI_CONTRACT_SCHEDULE_AWARE_v29
import { describe, expect, it } from "vitest";
import { analyzeContract, extractRequirements, findReferencedSchedules, isRequirementClause } from "../contractRequirements";

const CROSS_REFERENCE = "Contractor, Owner, and others as may be designated by the Prime Contract, shall be named as additional insureds on the commercial general liability insurance referred to in Schedule I.";
const CARVE_OUT = "Other than with respect to the automobile liability, workers' compensation and professional liability (if that is required under Schedule I) insurances, all insurance required by this Subcontract shall waive subrogation claims by Subcontractor's insurers against the Owner or Contractor.";
const DOCUMENT_LIST = "Schedule G: Quality Requirements\nSchedule H: LEED\nSchedule I: Insurance\nSchedule J: Schedule";
const REAL_REQUIREMENT = "Subcontractor shall procure and maintain Commercial General Liability insurance with a limit of not less than $5,000,000 per occurrence.";

describe("a named coverage is a candidate the applicant confirms", () => {
  it("keeps a coverage the contract only cross-references", () => {
    // BI_CONTRACT_ONLY_v32 - previously discarded, which left the page empty.
    expect(extractRequirements(CROSS_REFERENCE).map((r) => r.coverageCode)).toContain("cgl");
  });

  it("reads every coverage named in a carve-out sentence", () => {
    const codes = extractRequirements(CARVE_OUT).map((r) => r.coverageCode);
    expect(codes).toContain("auto_liability");
    expect(codes).toContain("workers_comp");
    expect(codes).toContain("eo");
  });

  it("still ignores the definitions section", () => {
    expect(extractRequirements('"Claim" means any and all actions for general liability.')).toHaveLength(0);
    expect(extractRequirements('"Delay" has the meaning given in Section 29.5.')).toHaveLength(0);
  });

  it("scores a stated limit above a bare mention", () => {
    const named = extractRequirements(REAL_REQUIREMENT)[0];
    const bare = extractRequirements("Commercial general liability insurance is required.")[0];
    expect(named.extractedLimit).toBe(5_000_000);
    expect(named.confidence).toBeGreaterThan(bare.confidence);
  });
});

describe("curly apostrophes are not invisible", () => {
  it("reads the punctuation a real PDF actually contains", () => {
    // Every one of these used a straight quote and could never have matched.
    expect(extractRequirements("Subcontractor shall maintain workers’ compensation coverage.")
      .map((r) => r.coverageCode)).toContain("workers_comp");
    expect(extractRequirements("Contractor’s Pollution Liability is required.")
      .map((r) => r.coverageCode)).toContain("cpl");
    expect(extractRequirements("Builder’s Risk is required.")
      .map((r) => r.coverageCode)).toContain("builders_risk");
    expect(extractRequirements("Contractor’s Equipment coverage is required.")
      .map((r) => r.coverageCode)).toContain("contractor_equipment");
  });
});

describe("the subcontract is the only document we ask for", () => {
  it("never reports a missing schedule", () => {
    const analysis = analyzeContract(`${CROSS_REFERENCE}\n${CARVE_OUT}\n${DOCUMENT_LIST}`);
    expect(analysis.missingSchedules).toEqual([]);
    expect(analysis.documentKind).toBe("requirements");
  });

  it("returns what it read instead of an empty list and a demand", () => {
    const analysis = analyzeContract(`${CROSS_REFERENCE}\n${CARVE_OUT}`);
    expect(analysis.requirements.length).toBeGreaterThan(0);
  });

  it("reads both bonds from a single sentence", () => {
    const codes = extractRequirements(
      "The Subcontractor shall provide a performance bond and a labour and material payment bond.",
    ).map((r) => r.coverageCode);
    expect(codes).toContain("surety_performance");
    expect(codes).toContain("surety_payment");
  });
});
