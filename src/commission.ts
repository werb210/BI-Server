export function calculatePremium(
  loanAmount: number,
  securedType: "secured" | "unsecured"
) {
  const rate = securedType === "secured" ? 0.016 : 0.04;

  const coverageAmount = Math.min(loanAmount * 0.8, 1400000);
  const annualPremium = loanAmount * rate;
  const borealCommission = annualPremium * 0.1;

  return {
    coverageAmount,
    annualPremium,
    borealCommission
  };
}

export function calculateCommission(annualPremium: number) {
  return annualPremium * 0.1;
}
