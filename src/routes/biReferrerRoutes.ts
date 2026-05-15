import { Router } from "express";
import { pool } from "../db";
import jwt from "jsonwebtoken";
import { env } from "../platform/env";
// BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1 — typed wrappers
import { sendOtpSafe, verifyOtpSafe } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";

const router = Router();
// BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1
router.post("/referrer/otp/start", async (req, res) => {
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const sr = await sendOtpSafe(phone);
  if (!sr.ok) return res.status(502).json({ error: "otp_send_failed", detail: sr.error });
  res.json({ ok: true });
});
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2 / v278
// bi_referrers stores phone in phone_e164 (per 2026_05_14_referrer_portal_v238.sql).
router.post("/referrer/otp/verify", async (req, res) => {
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });
  const vr = await verifyOtpSafe(phone, code);
  if (!vr.ok) return res.status(502).json({ error: "otp_verify_failed", detail: vr.error });
  if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });
  let r = await pool.query(`SELECT * FROM bi_referrers WHERE phone_e164=$1`, [phone]);
  if (!r.rows[0]) {
    await pool.query(`INSERT INTO bi_referrers (phone_e164) VALUES ($1)`, [phone]);
    r = await pool.query(`SELECT * FROM bi_referrers WHERE phone_e164=$1`, [phone]);
  }
  const ref = r.rows[0];
  const token = jwt.sign({ kind: "referrer", id: ref.id }, env.JWT_SECRET || "dev-missing-jwt-secret", { expiresIn: "7d" });
  res.json({ token, intake_complete: ref.intake_complete });
});
function requireReferrer(req: any, res: any, next: any) { const auth = String(req.headers.authorization ?? ""); if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" }); try { const claims: any = jwt.verify(auth.slice(7), env.JWT_SECRET || "dev-missing-jwt-secret"); if (claims.kind !== "referrer") return res.status(403).json({ error: "wrong_session" }); req.referrerId = claims.id; next(); } catch { return res.status(401).json({ error: "invalid_token" }); } }

// BI_SERVER_BLOCK_v333_REFERRER_ME_HANDLER_v1
// Pre-fix GET /api/v1/referrer/me 404'd because no handler existed in this
// router. The BI-Website /referrer portal calls /referrer/me immediately
// post-OTP to populate the logged-in referrer's profile (name, intake
// completion status). The 404 left the portal stuck on a "loading…" state
// with no user object. Adding the handler -- mirrors GET /lender/me at
// biLenderApiRoutes.ts:258. requireReferrer JWT-verifies the bearer token
// and binds claims.id to req.referrerId; we then load the row from
// bi_referrers and return the public profile shape the portal expects
// ({ referrer, intake_complete }).
router.get("/referrer/me", requireReferrer, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, full_name, company_name, email,
            phone_e164 AS phone, address_line1, address_line2, city,
            province, postal_code, country, etransfer_email,
            intake_complete, created_at
       FROM bi_referrers
      WHERE id = $1
      LIMIT 1`,
    [req.referrerId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "referrer_not_found" });
  const ref = r.rows[0];
  res.json({ referrer: ref, intake_complete: Boolean(ref.intake_complete) });
});
router.post("/referrer/intake", requireReferrer, async (req: any, res) => { const b = req.body ?? {}; const required = ["first_name","last_name","email","address_line1","city","province","postal_code","country"]; const missing = required.filter((k) => !b[k]); if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing }) ; await pool.query(`UPDATE bi_referrers SET first_name=$1, last_name=$2, email=$3, company_name=$4, address_line1=$5, address_line2=$6, city=$7, province=$8, postal_code=$9, country=$10, etransfer_email=$11, intake_complete=TRUE, updated_at=NOW() WHERE id=$12`, [b.first_name,b.last_name,b.email,b.company_name ?? null,b.address_line1,b.address_line2 ?? null,b.city,b.province,b.postal_code,b.country,b.etransfer_email ?? null,req.referrerId]); res.json({ ok: true }); });
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
// bi_referrals.phone column does not exist; alias phone_e164 AS phone
// to keep the response payload contract unchanged.
router.get("/referrer/dashboard", requireReferrer, async (req: any, res) => { const r = await pool.query(`SELECT r.id, r.full_name, r.company_name, r.email, r.phone_e164 AS phone, r.status, r.created_at, a.id AS application_id, a.status AS application_status, a.annual_premium, a.business_name FROM bi_referrals r LEFT JOIN bi_applications a ON a.id = r.application_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 500`, [req.referrerId]); res.json({ referrals: r.rows }); });
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
// bi_referrals.phone -> phone_e164. bi_contacts has no company_name or
// updated_at column (per master schema 20260222_00 — bi_contacts joins
// bi_companies via company_id, no updated_at); drop both from the
// INSERT to avoid the next 500 in the chain.
router.post("/referrer/referrals", requireReferrer, async (req: any, res) => { const b = req.body ?? {}; const required = ["full_name","email","phone"]; const missing = required.filter((k) => !b[k]); if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing }) ; const r = await pool.query(`INSERT INTO bi_referrals (referrer_id, full_name, company_name, email, phone_e164, status) VALUES ($1,$2,$3,$4,$5,'invited') RETURNING id`, [req.referrerId, b.full_name, b.company_name ?? null, b.email, b.phone]); await pool.query(`INSERT INTO bi_contacts (id, full_name, email, phone_e164, tags, created_at) VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['referral'], NOW()) ON CONFLICT (email) DO UPDATE SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(bi_contacts.tags || ARRAY['referral'])))`, [b.full_name, b.email, b.phone]); res.status(201).json({ id: r.rows[0].id, status: "invited" }); });
export default router;
