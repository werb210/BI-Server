// BI_SERVER_PUSH_TOKENS_v159
// Device registration for BI-Client.
//
// BI-Client has had working push plumbing for a while - it asks for permission,
// registers with APNs/FCM and receives a token - but deliberately dropped that
// token on the floor, because this endpoint did not exist and the author was
// right not to guess at a URL. So BI push has never been able to work.
//
// Scoped to the applicant proven by OTP: the phone comes from the token, never
// from the body, matching biApplicantProfileRoutes.
import { Router } from "express";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();

const PLATFORMS = new Set(["ios", "android"]);

/** Tokens are long opaque strings; anything wildly outside that is not one. */
export function isPlausibleToken(raw: unknown): boolean {
  const value = String(raw ?? "").trim();
  return value.length >= 20 && value.length <= 4096 && !/\s/.test(value);
}

export function normalizePlatform(raw: unknown): "ios" | "android" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return PLATFORMS.has(value) ? (value as "ios" | "android") : null;
}

router.post("/client/push/register-token", authApplicant, async (req: ApplicantReq, res) => {
  const token = String(req.body?.token ?? "").trim();
  const platform = normalizePlatform(req.body?.platform);

  if (!isPlausibleToken(token)) {
    return res.status(400).json({ error: "token_required" });
  }
  if (!platform) {
    // The transport is chosen from this, so an unknown value is not storable.
    return res.status(400).json({ error: "platform_required" });
  }

  await pool.query(
    `INSERT INTO bi_client_push_tokens (token, applicant_phone, platform, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (token) DO UPDATE
       SET applicant_phone = EXCLUDED.applicant_phone,
           platform = EXCLUDED.platform,
           updated_at = NOW()`,
    [token, req.applicantPhone ?? null, platform],
  );

  return res.status(200).json({ ok: true });
});

// Signing out, or revoking notifications, should stop delivery to this device.
router.post("/client/push/unregister-token", authApplicant, async (req: ApplicantReq, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!token) return res.status(400).json({ error: "token_required" });
  await pool.query(
    `DELETE FROM bi_client_push_tokens WHERE token = $1 AND applicant_phone IS NOT DISTINCT FROM $2`,
    [token, req.applicantPhone ?? null],
  );
  return res.status(200).json({ ok: true });
});

export default router;
