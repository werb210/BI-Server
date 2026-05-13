import { Router } from "express";
import { pool } from "../db";
import jwt from "jsonwebtoken";
import { env } from "../platform/env";
import { sendOtp, verifyOtp } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";

const router = Router();
router.post("/referrer/otp/start", async (req, res) => { const phone = normalizeE164(req.body?.phone); if (!phone) return res.status(400).json({ error: "invalid_phone" }); await sendOtp(phone); res.json({ ok: true }); });
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v1
// bi_referrers.phone column does not exist; the real column is
// phone_e164 (per migration 2026_05_14_referrer_portal_v238.sql).
// Three SQL references in this handler all updated together.
router.post("/referrer/otp/verify", async (req, res) => { const phone = normalizeE164(req.body?.phone); const code = String(req.body?.code ?? "").trim(); if (!phone) return res.status(400).json({ error: "invalid_phone" }); if (!code) return res.status(400).json({ error: "missing_code" }); if (!await verifyOtp(phone, code)) return res.status(401).json({ error: "invalid_otp" }); let r = await pool.query(`SELECT * FROM bi_referrers WHERE phone_e164=$1`, [phone]); if (!r.rows[0]) { await pool.query(`INSERT INTO bi_referrers (phone_e164) VALUES ($1)`, [phone]); r = await pool.query(`SELECT * FROM bi_referrers WHERE phone_e164=$1`, [phone]); } const ref = r.rows[0]; const token = jwt.sign({ kind: "referrer", id: ref.id }, env.JWT_SECRET || "dev-missing-jwt-secret", { expiresIn: "7d" }); res.json({ token, intake_complete: ref.intake_complete }); });
function requireReferrer(req: any, res: any, next: any) { const auth = String(req.headers.authorization ?? ""); if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" }); try { const claims: any = jwt.verify(auth.slice(7), env.JWT_SECRET || "dev-missing-jwt-secret"); if (claims.kind !== "referrer") return res.status(403).json({ error: "wrong_session" }); req.referrerId = claims.id; next(); } catch { return res.status(401).json({ error: "invalid_token" }); } }
router.post("/referrer/intake", requireReferrer, async (req: any, res) => { const b = req.body ?? {}; const required = ["first_name","last_name","email","address_line1","city","province","postal_code","country"]; const missing = required.filter((k) => !b[k]); if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing }); await pool.query(`UPDATE bi_referrers SET first_name=$1, last_name=$2, email=$3, company_name=$4, address_line1=$5, address_line2=$6, city=$7, province=$8, postal_code=$9, country=$10, etransfer_email=$11, intake_complete=TRUE, updated_at=NOW() WHERE id=$12`, [b.first_name,b.last_name,b.email,b.company_name ?? null,b.address_line1,b.address_line2 ?? null,b.city,b.province,b.postal_code,b.country,b.etransfer_email ?? null,req.referrerId]); res.json({ ok: true }); });
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v1
// bi_referrals.phone column does not exist; column is phone_e164.
// Alias as `phone` to keep the response payload contract unchanged.
router.get("/referrer/dashboard", requireReferrer, async (req: any, res) => { const r = await pool.query(`SELECT r.id, r.full_name, r.company_name, r.email, r.phone_e164 AS phone, r.status, r.created_at, a.id AS application_id, a.status AS application_status, a.annual_premium, a.business_name FROM bi_referrals r LEFT JOIN bi_applications a ON a.id = r.application_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 500`, [req.referrerId]); res.json({ referrals: r.rows }); });
// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v1
// bi_referrals and bi_contacts both store phone in phone_e164.
// bi_contacts has no company_name column (per the master schema
// 20260222_00 — bi_contacts joins bi_companies via company_id);
// drop that column from the INSERT to avoid the next 500 in the chain.
router.post("/referrer/referrals", requireReferrer, async (req: any, res) => { const b = req.body ?? {}; const required = ["full_name","email","phone"]; const missing = required.filter((k) => !b[k]); if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing }); const r = await pool.query(`INSERT INTO bi_referrals (referrer_id, full_name, company_name, email, phone_e164, status) VALUES ($1,$2,$3,$4,$5,'invited') RETURNING id`, [req.referrerId, b.full_name, b.company_name ?? null, b.email, b.phone]); await pool.query(`INSERT INTO bi_contacts (id, full_name, email, phone_e164, tags, created_at) VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['referral'], NOW()) ON CONFLICT (email) DO UPDATE SET tags = (SELECT ARRAY(SELECT DISTINCT unnest(bi_contacts.tags || ARRAY['referral'])))`, [b.full_name, b.email, b.phone]); res.status(201).json({ id: r.rows[0].id, status: "invited" }); });
export default router;
