import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { pgiScore } from "../services/pgiAdapter";
import { sendOtp, verifyOtp } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";
import { generatePublicId } from "../util/publicId";

const router = Router();
const EBITDA_MIN = 50_000;

// BI_SERVER_BLOCK_v62_LENDER_AUTH_DUAL_HEADER_v1
// Lender Portal sends X-API-Key; LenderApiDocs documents Authorization: Bearer.
// Accept either so both clients (and any third-party integrations using either
// convention) work without a coordinated client-side change.
// BI_SERVER_BLOCK_v205_LENDER_OTP_AND_PIPELINE_v1
// authLender accepts THREE credential forms:
//   1) Lender JWT (Authorization: Bearer <jwt>) issued by /lender/otp/verify
//   2) API key in Authorization: Bearer <bk_xxx...>
//   3) API key in X-API-Key header
// Order: try JWT first (cheap, in-memory verify); if it parses with kind=lender,
// trust it. Otherwise treat the value as an API key and look it up by sha256.
async function authLender(req: any, res: any, next: any) {
  const auth = String(req.headers.authorization ?? "");
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerKey = String(req.headers["x-api-key"] ?? "").trim();
  const candidate = bearerToken || headerKey;
  if (!candidate) return res.status(401).json({ error: "missing_api_key" });

  // Try lender JWT first — JWTs have exactly two dots; API keys do not.
  if (bearerToken && bearerToken.split(".").length === 3) {
    try {
      const claims: any = jwt.verify(bearerToken, env.JWT_SECRET || "dev-missing-jwt-secret");
      if (claims && claims.kind === "lender" && claims.id) {
        req.lenderId = claims.id;
        return next();
      }
    } catch {
      // fall through to API key check
    }
  }

  // Fall back to API key (sha256 lookup).
  const hash = crypto.createHash("sha256").update(candidate).digest("hex");
  const r = await pool.query(`SELECT lender_id FROM bi_lender_api_keys WHERE key_hash=$1 AND is_active=TRUE LIMIT 1`, [hash]);
  const row = r.rows[0];
  if (!row) return res.status(401).json({ error: "invalid_api_key" });
  await pool.query(`UPDATE bi_lender_api_keys SET last_used_at=NOW() WHERE key_hash=$1`, [hash]).catch(() => {});
  req.lenderId = row.lender_id;
  next();
}

router.post("/lender/applications", authLender, async (req: any, res) => {
  const b = req.body ?? {};
  const scoreReq = ["country","naics_code","formation_date","loan_amount","pgi_limit","annual_revenue","ebitda","total_debt","monthly_debt_service","collateral_value","enterprise_value"];
  const missing = scoreReq.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });
  if (b.country !== "CA") return res.status(400).json({ error: "country_unsupported", supported: ["CA"] });
  if (Number(b.ebitda) < EBITDA_MIN) return res.status(400).json({ error: "ebitda_below_min", min: EBITDA_MIN });

  const score = await pgiScore({
    country: b.country, naics_code: b.naics_code,
    formation_date: b.formation_date,
    loan_amount: Number(b.loan_amount), pgi_limit: Number(b.pgi_limit),
    annual_revenue: Number(b.annual_revenue), ebitda: Number(b.ebitda),
    total_debt: Number(b.total_debt),
    monthly_debt_service: Number(b.monthly_debt_service),
    collateral_value: Number(b.collateral_value),
    enterprise_value: Number(b.enterprise_value),
  });

  if (score.decision === "decline") {
    return res.status(422).json({
      error: "score_declined",
      reason: ("reason" in score) ? score.reason : null,
      score_id: score.score_id,
    });
  }

  const id = crypto.randomUUID();
  const publicId = generatePublicId();
  // BI_SERVER_BLOCK_v172_SOURCE_TYPE_NORMALIZE_v1
  // Set source_type explicitly to 'lender' (not the legacy 'lender_api')
  // so it matches V1 ruling 5 and stays aligned with the source column.
  // BI_SERVER_BLOCK_v207_CREATED_BY_ACTOR_NOT_NULL_FIX_v1
  // (1) bi_applications.created_by_actor is NOT NULL — set 'lender'.
  // (2) Dual-populate `created_by_lender_id` (modern FK, used by
  //     /lender/applications/mine) AND `lender_id` (legacy, used by the
  //     existing /lender/applications GET). req.lenderId fills both.
  await pool.query(`INSERT INTO bi_applications
       (id, public_id, status, source, source_type,
        created_by_actor, created_by_lender_id, lender_id,
        guarantor_name, guarantor_email, business_name, lender_name,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        bankruptcy_history, insolvency_history, judgment_history,
        score_id, score_value, score_decision, score_at,
        form_data, created_at, updated_at)
     VALUES ($1,$2,'ready_for_submission','lender','lender',
             'lender',$3,$3,
             $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,NOW(),$25,NOW(),NOW())`,
    [id, publicId, req.lenderId,
     b.guarantor_name, b.guarantor_email, b.business_name, b.lender_name ?? null,
     b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
     b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
     b.collateral_value, b.enterprise_value,
     Boolean(b.bankruptcy_history), Boolean(b.insolvency_history), Boolean(b.judgment_history),
     score.score_id, ("score" in score) ? score.score : null, score.decision,
     b]);
  return res.status(201).json({
    public_id: publicId,
    application_id: id,
    status: "ready_for_submission",
    score_id: score.score_id,
    score: "score" in score ? score.score : null,
  });
});

router.get("/lender/applications", authLender, async (req: any, res) => {
  const r = await pool.query(`SELECT id, status, business_name, loan_amount, pgi_limit, annual_premium, quote_id, underwriter_ref, created_at, updated_at FROM bi_applications WHERE lender_id=$1 ORDER BY updated_at DESC LIMIT 200`, [req.lenderId]);
  return res.json({ applications: r.rows });
});


// BI_SERVER_BLOCK_v205_LENDER_OTP_AND_PIPELINE_v1 — Lender OTP + pipeline routes.
// Lenders are provisioned by staff (bi_lenders row + contact_phone_e164 set).
// Login is OTP-SMS to that registered phone. After verify we issue a JWT
// with kind=lender + id=<lender_id>, scope every endpoint to req.lenderId.
//
// Public (no auth): /lender/otp/start, /lender/otp/verify
// Auth (lender JWT): /lender/me, /lender/applications/mine

router.post("/lender/otp/start", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  // Phone must be registered to an existing lender. We do NOT auto-create
  // (unlike referrers) because lenders are gated B2B partners.
  const r = await pool.query(
    `SELECT id FROM bi_lenders WHERE contact_phone_e164 = $1 LIMIT 1`,
    [phone],
  );
  if (!r.rows[0]) {
    // Don't leak phone enumeration. Pretend we sent.
    return res.json({ ok: true });
  }

  await sendOtp(phone);
  res.json({ ok: true });
});

router.post("/lender/otp/verify", async (req, res) => {
  // BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });

  const r = await pool.query(
    `SELECT id, company_name, rep_full_name, rep_email FROM bi_lenders WHERE contact_phone_e164 = $1 LIMIT 1`,
    [phone],
  );
  if (!r.rows[0]) return res.status(401).json({ error: "phone_not_registered" });

  const ok = await verifyOtp(phone, code);
  if (!ok) return res.status(401).json({ error: "invalid_otp" });

  const lender = r.rows[0];
  const token = jwt.sign(
    { kind: "lender", id: lender.id },
    env.JWT_SECRET || "dev-missing-jwt-secret",
    { expiresIn: "7d" },
  );
  res.json({
    token,
    lender: {
      id: lender.id,
      company_name: lender.company_name,
      rep_full_name: lender.rep_full_name,
      rep_email: lender.rep_email,
    },
  });
});

router.get("/lender/me", authLender, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, company_name, rep_full_name, rep_email, contact_phone_e164 FROM bi_lenders WHERE id = $1`,
    [req.lenderId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_found" });
  res.json({ lender: r.rows[0] });
});

router.get("/lender/applications/mine", authLender, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, public_id, application_code, status,
              business_name, company_name, guarantor_name,
              loan_amount, pgi_limit, annual_premium,
              pgi_application_id, score_decision,
              core_inputs, created_at, updated_at
       FROM bi_applications
       -- BI_SERVER_BLOCK_v206_LENDER_PIPELINE_COLUMN_FIX_v1 - column is created_by_lender_id per FK constraint.
       -- BI_SERVER_BLOCK_v223_LENDER_CARRIER_FORWARDING_v1 - surface application_code + pgi_application_id + company_name.
       WHERE created_by_lender_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
    [req.lenderId],
  );
  res.json({ applications: r.rows });
});

export default router;
