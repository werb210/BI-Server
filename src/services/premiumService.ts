export function calculatePremium({
  loanAmount,
  facilityType
}: {
  loanAmount: number;
  facilityType: "secured" | "unsecured";
}) {
  const rate = facilityType === "secured" ? 0.016 : 0.04;

  const insuredCap = loanAmount * 0.8;
  const maxCoverage = 1_400_000;

  const insuredAmount = Math.min(insuredCap, maxCoverage);

  const annualPremium = loanAmount * rate;

  return {
    rate,
    insuredAmount,
    annualPremium
  };
}
