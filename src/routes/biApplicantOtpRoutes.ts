// BI_SERVER_BLOCK_v207_HOTFIX_AND_APPLICANT_OTP_v1
import { Router } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
// BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1 — typed wrappers
import { sendOtpSafe, verifyOtpSafe } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";

const router = Router();

router.post("/applicants/otp/start", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1 / v278
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const r = await sendOtpSafe(phone);
  // BI_SERVER_BLOCK_v321_OTP_ERROR_MAPPING_v1
  if (!r.ok) {
    const detail = String(r.error ?? "");
    const isRateLimit = /max send attempts|too many|rate.?limit/i.test(detail);
    if (isRateLimit) {
      res.setHeader("Retry-After", "600");
      return res.status(429).json({ error: "otp_rate_limited", detail: "Too many OTP requests for this phone. Please wait 10 minutes and try again." });
    }
    return res.status(502).json({ error: "otp_send_failed", detail });
  }
  res.json({ ok: true });
});

router.post("/applicants/otp/verify", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1 / v278
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });
  const vr = await verifyOtpSafe(phone, code);
  // BI_SERVER_BLOCK_v321_OTP_ERROR_MAPPING_v1
  if (!vr.ok) {
    const detail = String(vr.error ?? "");
    const isRateLimit = /max check attempts|too many|rate.?limit/i.test(detail);
    if (isRateLimit) {
      res.setHeader("Retry-After", "600");
      return res.status(429).json({ error: "otp_rate_limited", detail: "Too many code-check attempts. Please request a new code in 10 minutes." });
    }
    return res.status(502).json({ error: "otp_verify_failed", detail });
  }
  if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });

  let contactId: string | null = null;
  try {
    // BI_SERVER_BLOCK_v209_BI_CONTACTS_SCHEMA_FIX_v1: real columns are
    // phone_e164 + full_name(NOT NULL); no updated_at column exists.
    const sel = await pool.query(`SELECT id FROM bi_contacts WHERE phone_e164 = $1 LIMIT 1`, [phone]);
    if (sel.rows[0]) {
      contactId = sel.rows[0].id;
    } else {
      // BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1
      // Try to lift a real name from any in-flight application with this
      // phone as the guarantor. Fall back to a non-placeholder label that
      // makes it obvious in the CRM list the contact needs enrichment.
      const guarantor = await pool.query<{ guarantor_name: string | null; guarantor_email: string | null }>(
        `SELECT guarantor_name, guarantor_email FROM bi_applications WHERE guarantor_phone = $1 ORDER BY created_at DESC LIMIT 1`,
        [phone],
      ).catch(() => ({ rows: [] as Array<{ guarantor_name: string | null; guarantor_email: string | null }> }));
      const guarantorName = guarantor.rows[0]?.guarantor_name?.trim() || null;
      const guarantorEmail = guarantor.rows[0]?.guarantor_email?.trim() || null;
      const displayName = guarantorName ?? `New applicant (${phone})`;
      const ins = await pool.query(
        `INSERT INTO bi_contacts (id, full_name, email, phone_e164, tags, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['applicant_otp']::text[], NOW())
         RETURNING id`,
        [displayName, guarantorEmail, phone],
      );
      contactId = ins.rows[0]?.id ?? null;
    }
  } catch (e) {
    console.warn("[applicant_otp_verify] bi_contacts upsert failed (non-blocking):", (e as any)?.message ?? e);
  }

  const token = jwt.sign(
    { kind: "applicant", phone, ...(contactId ? { contactId } : {}) },
    env.JWT_SECRET || "dev-missing-jwt-secret",
    { expiresIn: "1h" },
  );
  res.json({ token, phone, contactId });
});

export default router;
