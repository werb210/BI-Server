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

// BI_SERVER_BLOCK_v308_REFERRER_ME_PROFILE_WRAPPER_v1 — restore the
// { profile: {...} } shape the BI-Website ReferrerPortal has read since
// the page was first written. The previous shape ({ referrer, intake_complete })
// made hasProfile always false on the client, forcing every returning
// referrer back into the intake form. Keeps the `referrer` key as a
// legacy alias for any other consumer.
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
  const legal_name =
    (ref.full_name && String(ref.full_name).trim()) ||
    [ref.first_name, ref.last_name].filter(Boolean).join(" ").trim();
  const profile = {
    ...ref,
    legal_name,
    business_name: ref.company_name,
    address: ref.address_line1,
  };
  res.json({
    profile,
    intake_complete: Boolean(ref.intake_complete),
    // legacy alias — keep existing consumers working
    referrer: ref,
  });
});
router.post("/referrer/intake", requireReferrer, async (req: any, res) => { const b = req.body ?? {}; const required = ["first_name","last_name","email","address_line1","city","province","postal_code","country"]; const missing = required.filter((k) => !b[k]); if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing }) ; await pool.query(`UPDATE bi_referrers SET first_name=$1, last_name=$2, email=$3, company_name=$4, address_line1=$5, address_line2=$6, city=$7, province=$8, postal_code=$9, country=$10, etransfer_email=$11, intake_complete=TRUE, updated_at=NOW() WHERE id=$12`, [b.first_name,b.last_name,b.email,b.company_name ?? null,b.address_line1,b.address_line2 ?? null,b.city,b.province,b.postal_code,b.country,b.etransfer_email ?? null,req.referrerId]); res.json({ ok: true }); });
// BI_SERVER_BLOCK_v242_PIPELINE_AND_REMINDERS_v1 — RESTful PUT alias for
// the intake update. The ReferrerPortal frontend has called PUT
// /referrer/me since the page was first written; we only ever had POST
// /referrer/intake on the server, so every save returned 401 (the
// generic Express 404-on-unknown-method-for-known-path response, which
// our requireReferrer-protected router surfaces as 401). The frontend
// posts { profile: {...} } as the body, where profile contains the
// flat key/value map the ReferrerPortal intake form collects (note:
// keys are legal_name / business_name / etransfer_email / etc., not
// the first_name/last_name/address_line1 the intake POST expects).
// We map the legacy frontend keys to the bi_referrers columns. If the
// frontend later switches to first_name/last_name/etc., both shapes
// will work because we accept both.
router.put("/referrer/me", requireReferrer, async (req: any, res) => {
  const body = req.body ?? {};
  const p = body.profile ?? body;
  // Accept both new (first_name) and legacy (legal_name "First Last") shapes.
  let first_name = p.first_name ?? "";
  let last_name = p.last_name ?? "";
  if (!first_name && !last_name && typeof p.legal_name === "string") {
    const parts = p.legal_name.trim().split(/\s+/);
    first_name = parts.shift() ?? "";
    last_name = parts.join(" ");
  }
  const email = p.email ?? "";
  const company_name = p.business_name ?? p.company_name ?? null;
  const etransfer_email = p.etransfer_email ?? null;
  const province = p.province ?? "";
  const city = p.city ?? "";
  const postal_code = p.postal_code ?? "";
  const country = p.country ?? "CA";
  const address_line1 = p.address ?? p.address_line1 ?? "";
  const address_line2 = p.address_line2 ?? null;
  // Minimum viable to flip intake_complete=TRUE: legal name + email.
  if (!first_name || !email) {
    return res.status(400).json({ error: "missing_fields", fields: ["legal_name", "email"].filter((k) => k === "legal_name" ? !first_name : !email) });
  }
  await pool.query(
    `UPDATE bi_referrers
        SET first_name=$1, last_name=$2, email=$3, company_name=$4,
            address_line1=$5, address_line2=$6, city=$7, province=$8,
            postal_code=$9, country=$10, etransfer_email=$11,
            intake_complete=TRUE, updated_at=NOW()
      WHERE id=$12`,
    [first_name, last_name, email, company_name, address_line1, address_line2, city, province, postal_code, country, etransfer_email, req.referrerId]
  );
  res.json({ ok: true });
});
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
// bi_referrals.phone column does not exist; alias phone_e164 AS phone
// to keep the response payload contract unchanged.
router.get("/referrer/dashboard", requireReferrer, async (req: any, res) => { const r = await pool.query(`SELECT r.id, r.full_name, r.company_name, r.email, r.phone_e164 AS phone, r.status, r.created_at, a.id AS application_id, a.status AS application_status, a.annual_premium, a.business_name FROM bi_referrals r LEFT JOIN bi_applications a ON a.id = r.application_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 500`, [req.referrerId]); res.json({ referrals: r.rows }); });
// BI_SERVER_BLOCK_v244_DEMO_REFERRER_STORAGE_v1 — alias for the
// pre-existing /referrer/dashboard. The BI-Website ReferrerPortal has
// always hit GET /referrer/referrals; that path 404'd, the catch block
// in ReferrerPortal.tsx's auth-bootstrap useEffect treated the 404 as
// a session failure and wiped the localStorage token, and the
// subsequent PUT /referrer/me 401'd with missing_token. Adding this
// alias is the server-side half of the fix; the client-side half
// (don't kill the token when /referrer/referrals fails) lives in
// BI-Website v179.
router.get("/referrer/referrals", requireReferrer, async (req: any, res) => {
  const r = await pool.query(
    `SELECT r.id, r.full_name, r.company_name, r.email, r.phone_e164 AS phone, r.status, r.created_at,
            a.id AS application_id, a.status AS application_status, a.annual_premium, a.business_name
       FROM bi_referrals r
       LEFT JOIN bi_applications a ON a.id = r.application_id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
      LIMIT 500`,
    [req.referrerId]
  );
  // Return both shapes — the frontend probes for `items` first, then
  // falls back to treating the response as a plain array.
  res.json({ items: r.rows, referrals: r.rows });
});
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
// bi_referrals.phone -> phone_e164. bi_contacts has no company_name or
// updated_at column (per master schema 20260222_00 — bi_contacts joins
// bi_companies via company_id, no updated_at); drop both from the
// INSERT to avoid the next 500 in the chain.
router.post("/referrer/referrals", requireReferrer, async (req: any, res) => {
  // BI_SERVER_BLOCK_v245_REFERRAL_FIELDS_v1 — was require [full_name,
  // email, phone] strictly. Now require full_name AND (email OR phone)
  // so referrers can submit a referral with only one contact channel
  // (operator-locked: SMS is the canonical channel for BI client
  // comms; some referrers won't have an email handy).
  const b = req.body ?? {};
  const full_name = String(b.full_name || b.name || "").trim();
  const email = String(b.email || "").trim();
  const phone = String(b.phone || b.mobile || "").trim();
  const company_name = b.company_name || b.company || null;
  if (!full_name) return res.status(400).json({ error: "missing_fields", fields: ["full_name"] });
  if (!email && !phone) return res.status(400).json({ error: "missing_fields", fields: ["email_or_phone"] });
  const r = await pool.query(
    `INSERT INTO bi_referrals (referrer_id, full_name, company_name, email, phone_e164, status)
     VALUES ($1,$2,$3,$4,$5,'invited') RETURNING id`,
    [req.referrerId, full_name, company_name, email || null, phone || null]
  );
  // Only mirror into bi_contacts if we have an email — the contacts
  // table uses email as a conflict target. Phone-only referrals just
  // live in bi_referrals.
  if (email) {
    await pool.query(
      `INSERT INTO bi_contacts (id, full_name, email, phone_e164, tags, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['referral'], NOW())
       ON CONFLICT (email) DO UPDATE SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(bi_contacts.tags || ARRAY['referral'])))`,
      [full_name, email, phone || null]
    );
  }
  res.status(201).json({ id: r.rows[0].id, status: "invited" });
});
export default router;
