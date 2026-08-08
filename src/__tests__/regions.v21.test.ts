// BI_SERVER_US_APPLICATIONS_v21
import { describe, expect, it } from "vitest";
import {
  CA_REGIONS,
  US_REGIONS,
  checkRegion,
  isSupportedCountry,
  isValidPostalCode,
  regionsFor,
} from "../services/regions";

describe("supported countries", () => {
  it("accepts the two the carrier now writes", () => {
    expect(isSupportedCountry("CA")).toBe(true);
    expect(isSupportedCountry("US")).toBe(true);
  });

  it("still refuses everything else", () => {
    for (const bad of ["GB", "MX", "ca", "", null, undefined, 1]) {
      expect(isSupportedCountry(bad)).toBe(false);
    }
  });
});

describe("region lists", () => {
  it("excludes Quebec from Canada", () => {
    expect(CA_REGIONS).not.toContain("QC");
    expect(CA_REGIONS.length).toBe(12);
  });

  it("covers all fifty states plus DC", () => {
    expect(US_REGIONS.length).toBe(51);
    expect(US_REGIONS).toContain("DC");
    for (const state of ["TX", "OH", "IL", "CO", "WA", "NC", "TN", "MA"]) {
      expect(US_REGIONS).toContain(state);
    }
  });

  it("returns the list matching the country", () => {
    expect(regionsFor("US")).toContain("TX");
    expect(regionsFor("CA")).toContain("AB");
  });
});

describe("checkRegion", () => {
  it("accepts a valid region for its own country", () => {
    expect(checkRegion("CA", "ON").ok).toBe(true);
    expect(checkRegion("US", "tx").ok).toBe(true);
  });

  it("refuses a province submitted as a US state", () => {
    const result = checkRegion("US", "ON");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("region_unsupported");
  });

  it("refuses a state submitted as a Canadian province", () => {
    expect(checkRegion("CA", "TX").ok).toBe(false);
  });

  it("names Quebec specifically rather than calling it unrecognised", () => {
    const result = checkRegion("CA", "QC");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("quebec_blocked");
  });

  it("does not treat CA the US state as Canada", () => {
    // "CA" is both a country code and California. The country decides.
    expect(checkRegion("US", "CA").ok).toBe(true);
    expect(checkRegion("CA", "CA").ok).toBe(false);
  });

  it("requires a region", () => {
    const result = checkRegion("US", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("region_required");
  });
});

describe("postal codes", () => {
  it("accepts Canadian postal codes with or without a space", () => {
    for (const postalCode of ["T4C 1A1", "t4c1a1", "M5V 3A8"]) {
      expect(isValidPostalCode("CA", postalCode)).toBe(true);
    }
  });

  it("accepts five and nine digit ZIP codes", () => {
    for (const zipCode of ["73301", "73301-1234", "733011234"]) {
      expect(isValidPostalCode("US", zipCode)).toBe(true);
    }
  });

  it("refuses a ZIP submitted as a postal code and vice versa", () => {
    expect(isValidPostalCode("CA", "73301")).toBe(false);
    expect(isValidPostalCode("US", "T4C 1A1")).toBe(false);
  });

  it("refuses the letters Canada Post never uses", () => {
    expect(isValidPostalCode("CA", "D4C 1A1")).toBe(false);
    expect(isValidPostalCode("CA", "T4I 1A1")).toBe(false);
  });

  it("refuses blanks", () => {
    for (const country of ["CA", "US"] as const) {
      expect(isValidPostalCode(country, "")).toBe(false);
      expect(isValidPostalCode(country, null)).toBe(false);
    }
  });
});
