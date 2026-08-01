import { describe, expect, it } from "vitest";
import { extractRequirements, parseBasis, parseLimit, splitClauses } from "../contractRequirements";

describe("BI client contract requirement extraction", () => {
  it("parses limits and bases", () => {
    expect(parseLimit("CGL $5 million")).toBe(5_000_000);
    expect(parseLimit("$2,000,000 per occurrence and $5,000,000 aggregate")).toBe(5_000_000);
    expect(parseLimit("section 12.4")).toBeNull();
    expect(parseBasis("$5M per occurrence")).toBe("per occurrence");
    expect(parseBasis("$5M inclusive")).toBe("inclusive");
  });

  it("splits schedules and drops fragments", () => {
    expect(splitClauses("Insurance required:\n- CGL $5,000,000\n- Contractors pollution $2,000,000")).toHaveLength(3);
    expect(splitClauses("Yes.\nNo.")).toHaveLength(0);
  });

  it("extracts, deduplicates, and retains evidence", () => {
    const text = [
      "Commercial General Liability insurance of $5,000,000 per occurrence.",
      "CGL is required.",
      "Contractors Pollution Liability of $2,000,000 is required.",
      "A Performance Bond in accordance with CCDC 221 is required.",
      "A Labour and Material Payment Bond per CCDC 222 is required.",
    ].join("\n");
    const found = extractRequirements(text);
    expect(found.map((item) => item.coverageCode)).toEqual(expect.arrayContaining(["cgl", "cpl", "surety_performance", "surety_payment"]));
    expect(found.filter((item) => item.coverageCode === "cgl")).toHaveLength(1);
    expect(found.find((item) => item.coverageCode === "cgl")?.extractedLimit).toBe(5_000_000);
    expect(found.find((item) => item.coverageCode === "cgl")?.clauseText).toContain("5,000,000");
  });

  it("scores named limits higher and handles junk", () => {
    expect(extractRequirements("CGL of $5,000,000 per occurrence.")[0].confidence)
      .toBeGreaterThan(extractRequirements("Commercial general liability insurance is required.")[0].confidence);
    expect(extractRequirements("\n\n")).toEqual([]);
    expect(extractRequirements("The parties agree to the scope of work.")).toEqual([]);
  });
});
