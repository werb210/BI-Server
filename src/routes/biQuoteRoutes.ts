import { Router } from "express";
import { calculatePremium } from "../services/premiumService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.post("/estimate", async (req, res) => {
  const { facilityType, loanAmount } = req.body ?? {};

  if (!facilityType || typeof loanAmount !== "number" || loanAmount <= 0) {
    return badRequest(res, "facilityType and positive loanAmount are required");
  }

  if (facilityType !== "secured" && facilityType !== "unsecured") {
    return badRequest(res, "facilityType must be 'secured' or 'unsecured'");
  }

  return ok(res, calculatePremium({ facilityType, loanAmount }));
});

export default router;
