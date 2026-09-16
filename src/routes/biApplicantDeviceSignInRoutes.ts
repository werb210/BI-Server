// BI_SERVER_APPLICANT_FACE_ID_v300
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { env } from "../platform/env";
import { authApplicant, type ApplicantReq } from "./applicantAuth";
import { enrollApplicantDevice, revokeApplicantDevices, signInApplicantDevice } from "../services/biApplicantDeviceSignIn";

const router = Router();
const q = (sql: string, params: unknown[]) => pool.query(sql, params as any[]);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited" }, validate: { xForwardedForHeader: false, trustProxy: false } });

router.post("/applicants/device-sign-in/enroll", authApplicant, async (req: ApplicantReq, res) => {
  try {
    const label = typeof req.body?.deviceLabel === "string" ? req.body.deviceLabel : null;
    res.status(201).json(await enrollApplicantDevice(q, String(req.applicantPhone), label));
  } catch (err) {
    console.error("[applicant-device-sign-in] enroll failed", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "enroll_failed" });
  }
});

router.post("/applicants/device-sign-in", limiter, async (req, res) => {
  try {
    const result = await signInApplicantDevice(q, String(req.body?.credentialId ?? ""), String(req.body?.secret ?? ""), env.JWT_SECRET || "dev-missing-jwt-secret");
    if (!result.ok) {
      console.warn(JSON.stringify({ event: "applicant_device_sign_in_rejected", reason: result.reason }));
      return res.status(401).json({ error: result.reason === "expired" ? "device_sign_in_expired" : "device_sign_in_invalid" });
    }
    return res.json({ token: result.token, phone: result.phone, contactId: result.contactId, secret: result.secret });
  } catch (err) {
    console.error("[applicant-device-sign-in] failed", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "device_sign_in_failed" });
  }
});

router.post("/applicants/device-sign-in/revoke", authApplicant, async (req: ApplicantReq, res) => {
  const credentialId = typeof req.body?.credentialId === "string" ? req.body.credentialId : null;
  res.json({ revoked: await revokeApplicantDevices(q, String(req.applicantPhone), credentialId) });
});

export default router;
