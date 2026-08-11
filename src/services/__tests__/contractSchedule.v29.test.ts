// BI_CONTRACT_SCHEDULE_AWARE_v29
import { describe, expect, it } from "vitest";
import { analyzeContract, extractRequirements, findReferencedSchedules, isRequirementClause } from "../contractRequirements";

const CROSS_REFERENCE = "Contractor, Owner, and others as may be designated by the Prime Contract, shall be named as additional insureds on the commercial general liability insurance referred to in Schedule I.";
const CARVE_OUT = "Other than with respect to the automobile liability, workers' compensation and professional liability (if that is required under Schedule I) insurances, all insurance required by this Subcontract shall waive subrogation claims by Subcontractor's insurers against the Owner or Contractor.";
const DOCUMENT_LIST = "Schedule G: Quality Requirements\nSchedule H: LEED\nSchedule I: Insurance\nSchedule J: Schedule";
const REAL_REQUIREMENT = "Subcontractor shall procure and maintain Commercial General Liability insurance with a limit of not less than $5,000,000 per occurrence.";

describe("a cross-reference is not a requirement", () => {
  it("ignores a clause that only points at the schedule", () => expect(extractRequirements(CROSS_REFERENCE)).toHaveLength(0));
  it("ignores a subrogation carve-out that merely names coverages", () => expect(extractRequirements(CARVE_OUT)).toHaveLength(0));
  it("keeps a clause that actually imposes the coverage", () => {
    const found = extractRequirements(REAL_REQUIREMENT);
    expect(found.map((requirement) => requirement.coverageCode)).toContain("cgl");
    expect(found[0].extractedLimit).toBe(5_000_000);
    expect(found[0].limitBasis).toBe("per occurrence");
  });
  it("treats a stated limit as evidence of a requirement on its own", () => {
    expect(isRequirementClause("CGL of $5,000,000 per occurrence", true)).toBe(true);
    expect(isRequirementClause("general liability referred to in Schedule I", false)).toBe(false);
  });
});

describe("one clause can demand more than one coverage", () => {
  it("no longer stops at the first rule that matches", () => {
    const codes = extractRequirements("Subcontractor shall maintain automobile liability and workers' compensation coverage of $2,000,000 inclusive.").map((requirement) => requirement.coverageCode);
    expect(codes).toContain("auto_liability");
    expect(codes).toContain("workers_comp");
  });
  it("reads both bonds from a single sentence", () => {
    const codes = extractRequirements("The Subcontractor shall provide a performance bond and a labour and material payment bond.").map((requirement) => requirement.coverageCode);
    expect(codes).toContain("surety_performance");
    expect(codes).toContain("surety_payment");
  });
});

describe("a contract that defers its coverage list says so", () => {
  it("names the insurance schedule the contract relies on", () => {
    expect(findReferencedSchedules(DOCUMENT_LIST)).toEqual([{ ref: "Schedule I", title: "Insurance" }]);
  });
  it("ignores schedules that carry no coverage terms", () => {
    expect(findReferencedSchedules("Schedule A: Scope of Work\nSchedule B: Payment Terms")).toHaveLength(0);
  });
  it("reports the agreement alone as incomplete rather than as a clean read", () => {
    const analysis = analyzeContract(`${CROSS_REFERENCE}\n${CARVE_OUT}\n${DOCUMENT_LIST}`);
    expect(analysis.documentKind).toBe("agreement_only");
    expect(analysis.missingSchedules).toEqual([{ ref: "Schedule I", title: "Insurance" }]);
    expect(analysis.requirements).toHaveLength(0);
  });
  it("asks for nothing once real limits are present", () => {
    const analysis = analyzeContract(`${DOCUMENT_LIST}\n${REAL_REQUIREMENT}`);
    expect(analysis.documentKind).toBe("requirements");
    expect(analysis.missingSchedules).toHaveLength(0);
  });
});
