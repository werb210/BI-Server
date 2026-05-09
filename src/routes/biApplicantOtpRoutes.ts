// BI_SERVER_BLOCK_v207_HOTFIX_AND_APPLICANT_OTP_v1
import { Router } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { sendOtp, verifyOtp } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";

const router = Router();

router.post("/applicants/otp/start", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1 — normalize before Twilio call to prevent error 60200.
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  await sendOtp(phone);
  res.json({ ok: true });
});

router.post("/applicants/otp/verify", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1 — phone must be normalized identically to /start so
  // the Twilio Verify session lookup matches.
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });
  const ok = await verifyOtp(phone, code);
  if (!ok) return res.status(401).json({ error: "invalid_otp" });

  let contactId: string | null = null;
  try {
    const sel = await pool.query(`SELECT id FROM bi_contacts WHERE phone = $1 LIMIT 1`, [phone]);
    if (sel.rows[0]) {
      contactId = sel.rows[0].id;
      await pool.query(`UPDATE bi_contacts SET updated_at = NOW() WHERE id = $1`, [contactId]);
    } else {
      const ins = await pool.query(
        `INSERT INTO bi_contacts (id, phone, tags, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, ARRAY['applicant_otp']::text[], NOW(), NOW())
         RETURNING id`,
        [phone],
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
