import { Router } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.post("/pgi-intake", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.email || !body.businessName) {
      return badRequest(res, "Missing required fields");
    }

    await pool.query(
      "INSERT INTO pgi_applications(data) VALUES ($1::jsonb)",
      [JSON.stringify({
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        email: body.email,
        phone: body.phone ?? null,
        businessName: body.businessName,
        loanAmount: body.loanAmount ?? null,
        referralCode: body.referralCode ?? null,
        utm_source: body.utm_source ?? null,
        utm_medium: body.utm_medium ?? null,
        utm_campaign: body.utm_campaign ?? null,
        submittedAt: new Date().toISOString(),
      })]
    );

    return ok(res, { success: true });
  } catch (error) {
    logger.error({ err: error }, "PGI intake failed");
    return badRequest(res, "Server error");
  }
});

export default router;
