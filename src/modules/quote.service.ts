export function calculatePremium(
  guaranteeAmount: number,
  termMonths: number
) {
  const baseRate = 0.02;
  const termMultiplier = termMonths > 36 ? 1.2 : 1;

  const estimatedPremium =
    guaranteeAmount * baseRate * termMultiplier;

  return {
    estimatedPremium,
    coveragePercentage: 80,
    disclaimer: "Indicative quote only. Subject to underwriting."
  };
}
