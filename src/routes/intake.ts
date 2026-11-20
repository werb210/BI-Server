import { Router } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { badRequest, ok } from "../utils/apiResponse";
import { ipRateLimit } from "../lib/ipRateLimit";

// SECURITY_SWEEP_2026_11_19 - the server-wide throttle is keyed by IP + email, so a new email each time went straight
// through. 20 submissions an hour per IP on top of it.
const intakeLimiter = ipRateLimit({ windowMs: 60 * 60 * 1000, limit: 20 });

const router = Router();

router.post("/pgi-intake", intakeLimiter, async (req, res) => {
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
