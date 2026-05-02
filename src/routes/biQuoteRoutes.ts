import { Router } from "express";
const router = Router();
router.get("/quote/calculate", (req, res) => {
  const loan = Math.min(Number(req.query.loan ?? 0), 1_000_000);
  const cov = Math.min(Math.max(Number(req.query.coverage ?? 0), 0), 0.80);
  const type = String(req.query.type ?? "secured");
  if (loan <= 0 || cov <= 0) return res.status(400).json({ error: "invalid" });
  const rate = type === "unsecured" ? 0.040 : 0.016;
  const coverageAmount = +(loan * cov).toFixed(2);
  const annualPremium = +(coverageAmount * rate).toFixed(2);
  res.json({ loan_amount: loan, coverage_percentage: cov, coverage_amount: coverageAmount, facility_type: type === "unsecured" ? "unsecured" : "secured", rate, annual_premium: annualPremium });
});
export default router;
