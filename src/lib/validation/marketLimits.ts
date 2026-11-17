// BI_SERVER_US_MARKET_LIMITS_v1 - the amounts a file may ask for depend on the country of the business.
//
// Canada (as before): loan up to $1,000,000, PGI limit up to $1,000,000 and never more than 80% of the loan.
// United States (PGicover "US Lenders and Partners" one-pager, November 2026): personal guarantees up to $5,000,000;
// the covered share is up to 90% on secured loans and up to 70% on unsecured loans. The one-pager sets no ceiling on
// the loan itself, so the US loan ceiling here is only a guard against typing errors.
export type Market = "CA" | "US";
export type MarketLimits = { market: Market; loanMax: number; pgiLimitMax: number; ratio: number; ratioUnsecured: number; currency: "CAD" | "USD";
  /** Indicative annual premium as a share of the insured amount. The insurer sets the real premium. */
  rate: number };

export const MARKET_LIMITS: Record<Market, MarketLimits> = {
  CA: { market: "CA", loanMax: 1_000_000, pgiLimitMax: 1_000_000, ratio: 0.8, ratioUnsecured: 0.8, currency: "CAD", rate: 0.027 },
  US: { market: "US", loanMax: 50_000_000, pgiLimitMax: 5_000_000, ratio: 0.9, ratioUnsecured: 0.7, currency: "USD", rate: 0.02 },
};

export const marketOf = (country: unknown): Market => {
  const c = String(country ?? "").trim().toUpperCase();
  return c === "US" || c === "USA" || c === "UNITED STATES" ? "US" : "CA";
};
export const limitsFor = (country: unknown): MarketLimits => MARKET_LIMITS[marketOf(country)];
export const money = (n: number): string => Math.round(n).toLocaleString("en-US");
