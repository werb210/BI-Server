// BI_HARDENING_v44 — V1 BI quote math.
// Spec (ruling 7): premium = coverage × rate. Loan cap $1,000,000. Coverage 0..0.8.
// Old math (loanAmount × rate, $1.4M cap) is replaced.
export const MAX_LOAN_AMOUNT = 1_000_000;
export const MAX_COVERAGE_RATIO = 0.8;
export const RATES = {
  secured: 0.016,
  unsecured: 0.04,
} as const;

export interface PremiumInput {
  loanAmount: number;
  facilityType: "secured" | "unsecured";
  coverage?: number; // 0..0.8 ratio; defaults to MAX_COVERAGE_RATIO
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
}

export function calculatePremium(input: PremiumInput): PremiumResult {
  const facilityType = input.facilityType;
  const rate = RATES[facilityType];
  const requestedLoan = Math.max(0, Number(input.loanAmount) || 0);
  const capped = requestedLoan > MAX_LOAN_AMOUNT;
  const loanAmount = Math.min(requestedLoan, MAX_LOAN_AMOUNT);
  const rawCoverage = input.coverage ?? MAX_COVERAGE_RATIO;
  const coverageRatio = Math.min(MAX_COVERAGE_RATIO, Math.max(0, Number(rawCoverage) || 0));
  const insuredAmount = loanAmount * coverageRatio;
  const annualPremium = insuredAmount * rate;
  const monthlyPremium = annualPremium / 12;
  return {
    rate,
    facilityType,
    loanAmount,
    coverageRatio,
    insuredAmount: Math.round(insuredAmount * 100) / 100,
    annualPremium: Math.round(annualPremium * 100) / 100,
    monthlyPremium: Math.round(monthlyPremium * 100) / 100,
    capped,
  };
}
