import { Router } from "express";
import { calculatePremium } from "../services/premiumService";
// BI_SERVER_PREMIUM_BY_COUNTRY_v1 - one calculation for every caller; `country=US` gives United States terms.
const router = Router();
router.get("/quote/calculate", (req, res) => {
  const loan = Number(req.query.loan ?? 0);
  const cov = Number(req.query.coverage ?? 0);
  if (!(loan > 0) || !(cov > 0)) return res.status(400).json({ error: "invalid" });
  const p = calculatePremium({ loanAmount: loan, coverage: cov, facilityType: String(req.query.type ?? "secured") === "unsecured" ? "unsecured" : "secured", country: req.query.country });
  res.json({ loan_amount: p.loanAmount, coverage_percentage: p.coverageRatio, coverage_amount: p.insuredAmount, facility_type: p.facilityType, rate: p.rate, annual_premium: p.annualPremium, monthly_premium: p.monthlyPremium, currency: p.currency, capped: p.capped });
});
export default router;
