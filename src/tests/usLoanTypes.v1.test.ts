// BI_SERVER_US_READY_v1
import { describe, expect, it } from "vitest";
import { loanTypesFor } from "../lib/validation/marketLimits";

describe("eligible loan types by country", () => {
  it("lets a US file be an unsecured loan (cover up to 70%)", () => {
    expect(loanTypesFor("US")).toContain("Unsecured Loan");
    expect(loanTypesFor("United States")).toContain("Unsecured Loan");
  });
  it("keeps Canada secured-only", () => {
    expect(loanTypesFor("CA")).toEqual(["Commercial Mortgage", "Other Secured Loan"]);
    expect(loanTypesFor(undefined)).not.toContain("Unsecured Loan");
  });
});
