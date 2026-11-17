// BI_SERVER_PREMIUM_BY_COUNTRY_v1 - indicative premium = insured amount x rate, by the country of the business.
//
//   Canada:        2.7% a year; loan up to $1,000,000; insured amount up to 80% of the loan.
//   United States: 2.0% a year; cover up to $5,000,000; insured amount up to 90% of a secured loan, 70% of an
//                  unsecured one (PGicover US one-pager, November 2026; rate confirmed by the carrier).
// The older figures (1.6% secured / 4.0% unsecured, one $1,000,000 / 80% rule for everyone) are retired. This is an
// estimate only: the insurer sets the premium after underwriting.
import { limitsFor } from "../lib/validation/marketLimits";

export const MAX_LOAN_AMOUNT = 1_000_000; // Canada; kept for callers that import it
export const MAX_COVERAGE_RATIO = 0.8; // Canada; kept for callers that import it

export interface PremiumInput {
  loanAmount: number;
  facilityType: "secured" | "unsecured";
  coverage?: number; // share of the loan, 0..max for the country; defaults to the most allowed
  country?: unknown; // "US" or "CA" (default)
}

export interface PremiumResult {
  rate: number;
  facilityType: "secured" | "unsecured";
  loanAmount: number;
  coverageRatio: number;
  insuredAmount: number;
  annualPremium: number;
  monthlyPremium: number;
  capped: boolean;
  currency: "CAD" | "USD";
}

export function calculatePremium(input: PremiumInput): PremiumResult {
  const lim = limitsFor(input.country);
  const facilityType = input.facilityType === "unsecured" ? "unsecured" : "secured";
  const maxRatio = facilityType === "unsecured" ? lim.ratioUnsecured : lim.ratio;
  const requestedLoan = Math.max(0, Number(input.loanAmount) || 0);
  const loanAmount = Math.min(requestedLoan, lim.loanMax);
  const rawCoverage = input.coverage ?? maxRatio;
  const coverageRatio = Math.min(maxRatio, Math.max(0, Number(rawCoverage) || 0));
  const uncapped = loanAmount * coverageRatio;
  const insuredAmount = Math.min(uncapped, lim.pgiLimitMax);
  const annualPremium = insuredAmount * lim.rate;
  return {
    rate: lim.rate,
    facilityType,
    loanAmount,
    coverageRatio,
    insuredAmount: Math.round(insuredAmount * 100) / 100,
    annualPremium: Math.round(annualPremium * 100) / 100,
    monthlyPremium: Math.round((annualPremium / 12) * 100) / 100,
    capped: requestedLoan > lim.loanMax || uncapped > lim.pgiLimitMax,
    currency: lim.currency,
  };
}
