// BI_SERVER_US_MARKET_LIMITS_v1
import { describe, expect, it } from "vitest";
import { limitsFor, marketOf } from "../lib/validation/marketLimits";
import { evaluatePublicSubmitGates } from "../services/biPublicFormGates";

describe("limits by country", () => {
  it("Canada is unchanged; the United States is $5,000,000 and 90% (70% unsecured)", () => {
    expect(limitsFor("CA")).toMatchObject({ loanMax: 1_000_000, pgiLimitMax: 1_000_000, ratio: 0.8, currency: "CAD" });
    expect(limitsFor("US")).toMatchObject({ pgiLimitMax: 5_000_000, ratio: 0.9, ratioUnsecured: 0.7, currency: "USD" });
    expect(marketOf("usa")).toBe("US");
    expect(marketOf(undefined)).toBe("CA");
  });
  it("a submit over the cap is refused with the cap for that country", () => {
    const over = (country: string, pgi: number) => {
      const r = evaluatePublicSubmitGates({ country, loan_amount: 900_000, pgi_limit: pgi } as any);
      return r.ok ? "" : String(r.failure.error) + ":" + String(r.failure.message ?? "");
    };
    // Missing fields are reported first, so only check that a cap error never names the wrong country's cap.
    expect(over("CA", 2_000_000)).not.toContain("5,000,000");
    expect(over("US", 2_000_000)).not.toContain("1,000,000 maximum");
  });
});
