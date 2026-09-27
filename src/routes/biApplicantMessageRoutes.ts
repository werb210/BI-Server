// BI_SERVER_BLOCK_v607_APPLICANT_MESSAGES
import { Router, type Response } from "express";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";
import { notifyBiClient } from "../services/notifyBiClient";
import { backendRequestIsAuthorized, relayApplicantMessages } from "../services/biApplicantMessages";

const router = Router();

async function relay(req: ApplicantReq, res: Response, method: "GET" | "POST") {
  try {
    const result = await relayApplicantMessages(String(req.applicantPhone), method, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[applicant-messages] BF relay failed", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "message_relay_failed" });
  }
}

router.get("/applicants/messages", authApplicant, (req: ApplicantReq, res) => relay(req, res, "GET"));
router.post("/applicants/messages", authApplicant, (req: ApplicantReq, res) => relay(req, res, "POST"));

router.post("/bi/applicant-messages/staff-reply", async (req, res) => {
  if (!backendRequestIsAuthorized(req.header("x-backend-token") || undefined)) return res.status(401).json({ error: "invalid_backend_token" });
  const applicationId = String(req.body?.application_id ?? req.body?.applicationId ?? "").trim();
  const body = String(req.body?.message ?? req.body?.body ?? "").trim();
  if (!applicationId || !body) return res.status(400).json({ error: "application_id_and_message_required" });
  const app = (await pool.query<{ applicant_phone_e164: string | null; guarantor_phone: string | null }>(
    `SELECT applicant_phone_e164, guarantor_phone FROM bi_applications WHERE id::text = $1 OR public_id::text = $1 LIMIT 1`, [applicationId],
  )).rows[0];
  if (!app) return res.status(404).json({ error: "application_not_found" });
  const result = await notifyBiClient({
    applicationId, kind: "APPLICATION_UPDATE", title: String(req.body?.title || "New message from Boreal"), body,
    sms: String(req.body?.sms || `Boreal: ${body}`), smsTo: app.applicant_phone_e164 || app.guarantor_phone || null,
    dedupeKey: String(req.body?.dedupe_key || req.body?.message_id || `staff-reply:${applicationId}:${body}`),
  });
  return res.json({ ok: result.channel !== "none", ...result });
});

export default router;
