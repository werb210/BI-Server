// BI_HARDENING_v44 — public quote estimate endpoint.
// IMPORTANT: this router is mounted at /api/v1/bi/quote in server.ts and that
// mount is wrapped with requireAuth. Quote is supposed to be public (BI-1).
// We defer the de-gating decision to server.ts — see the BI_HARDENING_v44
// patch there. The handler itself does no auth lookups.
import { Router } from "express";
import { calculatePremium, MAX_COVERAGE_RATIO, MAX_LOAN_AMOUNT } from "../services/premiumService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.post("/estimate", async (req, res) => {
  const { facilityType, loanAmount, coverage } = req.body ?? {};

  if (typeof loanAmount !== "number" || !Number.isFinite(loanAmount) || loanAmount <= 0) {
    return badRequest(res, "loanAmount must be a positive number");
  }
  if (facilityType !== "secured" && facilityType !== "unsecured") {
    return badRequest(res, "facilityType must be 'secured' or 'unsecured'");
  }
  if (coverage !== undefined) {
    if (typeof coverage !== "number" || !Number.isFinite(coverage)) {
      return badRequest(res, "coverage must be a number between 0 and 0.8");
    }
    if (coverage < 0 || coverage > MAX_COVERAGE_RATIO) {
      return badRequest(res, `coverage must be between 0 and ${MAX_COVERAGE_RATIO}`);
    }
  }

  const result = calculatePremium({ facilityType, loanAmount, coverage });
  return ok(res, {
    ...result,
    maxLoanAmount: MAX_LOAN_AMOUNT,
    maxCoverageRatio: MAX_COVERAGE_RATIO,
  });
});

export default router;
