// BI_SERVER_BLOCK_v607_APPLICANT_MESSAGES
// BI_SERVER_BLOCK_v611_MESSAGES_REPAIR - the routes BI-Client v608 calls, a multipart send
// (the app posts FormData: message + files), and the staff-reply notice BF-Server v606 sends.
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";
import { notifyBiClient } from "../services/notifyBiClient";
import { backendRequestIsAuthorized, filesToAttachments, relayApplicantMessages, serviceCallIsAuthorized } from "../services/biApplicantMessages";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2_500_000, files: 3 } });

async function relay(req: ApplicantReq, res: Response, method: "GET" | "POST", subpath = "", body?: unknown) {
  try {
    const result = await relayApplicantMessages(String(req.applicantPhone), method, body, fetch, subpath);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[applicant-messages] BF relay failed", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "message_relay_failed" });
  }
}

router.get("/applicants/messages", authApplicant, (req: ApplicantReq, res) => relay(req, res, "GET"));
router.get("/applicants/messages/unread-count", authApplicant, (req: ApplicantReq, res) => relay(req, res, "GET", "/unread"));
router.post("/applicants/messages/read", authApplicant, (req: ApplicantReq, res) => relay(req, res, "POST", "/read", {}));

router.post("/applicants/messages", authApplicant, (req: ApplicantReq, res: Response, next) => {
  upload.array("files", 3)(req, res, (err: unknown) => {
    if (err) return res.status(413).json({ error: "attachment_too_large", detail: "Up to 3 files of 2.5 MB each." });
    next();
  });
}, async (req: ApplicantReq, res: Response) => {
  const text = String(req.body?.message ?? req.body?.body ?? "").trim().slice(0, 4000);
  const attachments = [
    ...(await filesToAttachments(((req as any).files ?? []) as any[])),
    ...(Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 3) : []),
  ].slice(0, 3);
  if (!text && attachments.length === 0) return res.status(400).json({ error: "message_empty" });
  return relay(req, res, "POST", "", { body: text, attachments });
});

async function noticeByPhone(phone: string, body: string, title: string, dedupeKey: string) {
  const app = (await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM bi_applications
      WHERE right(regexp_replace(coalesce(applicant_phone_e164, ''), '[^0-9]', '', 'g'), 10) = right(regexp_replace($1, '[^0-9]', '', 'g'), 10)
      ORDER BY created_at DESC LIMIT 1`, [phone])).rows[0];
  const base = String(process.env.BI_CLIENT_URL || "https://client.boreal.insure").replace(/\/$/, "");
  return notifyBiClient({
    applicationId: app?.id ?? "", kind: "APPLICATION_UPDATE", title, body,
    sms: `Boreal Risk: you have a new message. Open the Boreal Risk app or ${base}/messages to read it.`, smsTo: phone, dedupeKey,
  });
}

// BF-Server v606 calls this when staff reply in the Insurance silo.
router.post("/bi/applicant-messages/from-bf", async (req: Request, res: Response) => {
  if (!serviceCallIsAuthorized({ authorization: req.header("authorization") || undefined, xServiceToken: req.header("x-service-token") || undefined, xBackendToken: req.header("x-backend-token") || undefined })) {
    return res.status(401).json({ error: "invalid_backend_token" });
  }
  const phone = String(req.body?.phone ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!phone || !body) return res.status(400).json({ error: "phone_and_body_required" });
  const who = String(req.body?.staff_name ?? "").trim() || "Boreal";
  try {
    const result = await noticeByPhone(phone, body.length > 140 ? body.slice(0, 137) + "..." : body, `New message from ${who}`, String(req.body?.message_id || `bf-reply:${phone}:${body.slice(0, 40)}`));
    return res.json({ ok: result.channel !== "none", ...result });
  } catch (err) {
    console.error("[applicant-messages] notice failed", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "notice_failed" });
  }
});

// Kept from v607: notice addressed by BI application id.
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
