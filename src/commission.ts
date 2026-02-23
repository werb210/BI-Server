export function calculatePremium(
  loanAmount: number,
  securedType: "secured" | "unsecured"
) {
  const rate = securedType === "secured" ? 0.016 : 0.04;
  return loanAmount * rate;
}

export function calculateCommission(annualPremium: number) {
  return annualPremium * 0.1;
}
