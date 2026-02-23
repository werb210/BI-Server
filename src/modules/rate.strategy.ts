export function getRateStrategy(amount: number, term: number) {
  if (amount > 500000) return 0.025;
  if (term > 48) return 0.022;
  return 0.02;
}
