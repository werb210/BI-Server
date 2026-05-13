import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit"; // BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1
import { notifyStaff } from "../services/staffNotifyService"; // BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1
import { pool } from "../db";
import { env } from "../platform/env";
import { pgiScore, pgiSubmit } from "../services/pgiAdapter"; // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1
import { sendOtp, verifyOtp } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";
import { generatePublicId } from "../util/publicId";

const router = Router();
// BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1 — Per-key (or per-IP fallback) rate limit.
const _lenderLimitPerMin = Number(process.env.RATE_LIMIT_LENDER_PER_MIN || 60);
const lenderRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number.isFinite(_lenderLimitPerMin) && _lenderLimitPerMin > 0 ? _lenderLimitPerMin : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = String(req.headers.authorization ?? "");
    const tok = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (tok) return `k:${crypto.createHash("sha256").update(tok).digest("hex").slice(0, 24)}`;
    return `ip:${req.ip || "unknown"}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: "rate_limited",
      message: "Too many requests. See Retry-After header for cooldown.",
    });
  },
});
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
        if (claims.user_id) req.lenderUserId = String(claims.user_id);
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

router.post("/lender/applications", authLender, lenderRateLimit, /* BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1 */ async (req: any, res) => {
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
        created_by_actor, created_by_lender_id, created_by_lender_user_id, lender_id,
        guarantor_name, guarantor_email, business_name, lender_name,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        bankruptcy_history, insolvency_history, judgment_history,
        score_id, score_value, score_decision, score_at,
        form_data, created_at, updated_at)
     VALUES ($1,$2,'ready_for_submission','lender','lender',
             'lender',$3,$26,$3,
             $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,NOW(),$25,NOW(),NOW())`,
    [id, publicId, req.lenderId,
     b.guarantor_name, b.guarantor_email, b.business_name, b.lender_name ?? null,
     b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
     b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
     b.collateral_value, b.enterprise_value,
     Boolean(b.bankruptcy_history), Boolean(b.insolvency_history), Boolean(b.judgment_history),
     score.score_id, ("score" in score) ? score.score : null, score.decision,
     b,
     req.lenderUserId ?? null]);
  // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1 — BUG #1 fix: auto-forward to carrier after
  let lenderCompanyName: string | null = null;
  let lenderIsDemo = false;
  try {
    const lr = await pool.query(`SELECT company_name, is_demo FROM bi_lenders WHERE id = $1 LIMIT 1`, [req.lenderId]);
    lenderCompanyName = (lr.rows[0]?.company_name as string | undefined) || null;
    lenderIsDemo = lr.rows[0]?.is_demo === true;
  } catch {}
  const carrierRequestBody = { guarantor_name: b.guarantor_name, guarantor_email: b.guarantor_email, business_name: b.business_name, lender_name: lenderCompanyName ?? b.lender_name ?? undefined, form_data: { country: b.country, naics_code: b.naics_code, formation_date: b.formation_date, loan_amount: Number(b.loan_amount), pgi_limit: Number(b.pgi_limit), annual_revenue: Number(b.annual_revenue), ebitda: Number(b.ebitda), total_debt: Number(b.total_debt), monthly_debt_service: Number(b.monthly_debt_service), collateral_value: Number(b.collateral_value), enterprise_value: Number(b.enterprise_value), bankruptcy_history: Boolean(b.bankruptcy_history), insolvency_history: Boolean(b.insolvency_history), judgment_history: Boolean(b.judgment_history), }, };
  let pgi_application_id: string | null = null;
  let pgi_status: string | null = null;
  let pgi_error: string | null = null;
  try {
    const submit = lenderIsDemo ? { application_id: `STUB_APP_DEMO_${Date.now()}`, status: "received", message: "Demo submission — carrier call skipped." } : await pgiSubmit(carrierRequestBody);
    pgi_application_id = submit.application_id;
    pgi_status = submit.status || "received";
    await pool.query(`UPDATE bi_applications SET pgi_application_id=$1,status='submitted',carrier_received_at=NOW(),carrier_last_event='application.submitted',carrier_last_event_at=NOW(),carrier_submission_request=$2::jsonb,carrier_submission_response=$3::jsonb,updated_at=NOW() WHERE id=$4`, [pgi_application_id, JSON.stringify(carrierRequestBody), JSON.stringify(submit), id]);
  } catch (e: any) {
    pgi_error = String(e?.message ?? e);
  }

  return res.status(201).json({
    public_id: publicId,
    application_id: id,
    status: pgi_application_id ? "submitted" : "ready_for_submission",
    score_id: score.score_id,
    score: "score" in score ? score.score : null,
    pgi_application_id,
    pgi_status,
    pgi_error,
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

  // Multi-tenant contact lookup first; legacy primary fallback below.
  const r = await pool.query(
    `SELECT c.id FROM bi_lender_contacts c JOIN bi_lenders l ON l.id = c.lender_id WHERE c.phone_e164 = $1 AND c.is_active = TRUE AND l.is_active = TRUE LIMIT 1`,
    [phone],
  );
  if (r.rows[0]) {
    await sendOtp(phone);
    return res.json({ ok: true });
  }
  const primary = await pool.query(`SELECT id FROM bi_lenders WHERE contact_phone_e164 = $1 AND is_active = TRUE LIMIT 1`, [phone]);
  if (primary.rows[0]) await sendOtp(phone);
  res.json({ ok: true });
});

// BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1
// BI_SERVER_BLOCK_v227_APPLICATION_CODE_AND_DEMO_FIXUP_v1 — uses module-level jwt; registered at BOTH
// /lender/demo-session (hyphen) and /lender/demo/session (slash) so any
// in-the-wild client URL works.
async function demoSessionHandler(_req: any, res: any) {
  const r = await pool.query(
    `SELECT id, company_name FROM bi_lenders WHERE is_demo = TRUE AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`
  );
  const demo = r.rows[0];
  if (!demo) return res.status(503).json({ error: "demo_lender_missing", message: "Demo lender not provisioned." });
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "server_misconfig", message: "JWT_SECRET not set" });
  const token = jwt.sign(
    { kind: "lender", id: demo.id, is_demo: true },
    secret,
    { expiresIn: "4h" },
  );
  return res.json({ token, lender: { id: demo.id, company_name: demo.company_name, is_demo: true } });
}
router.post("/lender/demo-session", demoSessionHandler);
router.post("/lender/demo/session", demoSessionHandler);

router.post("/lender/otp/verify", async (req, res) => {
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });

  let row: any;
  const cr = await pool.query(`SELECT c.id AS contact_id, l.id AS lender_id, l.company_name, c.full_name, c.email, c.role FROM bi_lender_contacts c JOIN bi_lenders l ON l.id=c.lender_id WHERE c.phone_e164=$1 AND c.is_active=TRUE AND l.is_active=TRUE LIMIT 1`, [phone]);
  if (cr.rows[0]) row = cr.rows[0];
  else {
    const lr = await pool.query(`SELECT id, company_name, contact_full_name, contact_email FROM bi_lenders WHERE contact_phone_e164=$1 AND is_active=TRUE LIMIT 1`, [phone]);
    if (lr.rows[0]) {
      const ins = await pool.query(`INSERT INTO bi_lender_contacts (lender_id, full_name, email, phone_e164, role, is_primary, is_active) VALUES ($1, COALESCE(NULLIF(TRIM($2), ''), '(primary)'), NULLIF(LOWER(TRIM($3)), ''), $4, 'primary', TRUE, TRUE) RETURNING id`, [lr.rows[0].id, lr.rows[0].contact_full_name, lr.rows[0].contact_email, phone]);
      row = { contact_id: ins.rows[0].id, lender_id: lr.rows[0].id, company_name: lr.rows[0].company_name, full_name: lr.rows[0].contact_full_name, email: lr.rows[0].contact_email, role: 'primary' };
    }
  }
  if (!row) return res.status(401).json({ error: "phone_not_registered" });
  const ok = await verifyOtp(phone, code);
  if (!ok) return res.status(401).json({ error: "invalid_otp" });
  if (row.contact_id) await pool.query(`UPDATE bi_lender_contacts SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1`, [row.contact_id]).catch(()=>{});
  const token = jwt.sign({ kind: "lender", id: row.lender_id, user_id: row.contact_id }, env.JWT_SECRET || "dev-missing-jwt-secret", { expiresIn: "7d" });
  res.json({ token, lender: { id: row.lender_id, company_name: row.company_name }, user: { id: row.contact_id, full_name: row.full_name, email: row.email, role: row.role } });
});

router.get("/lender/me", authLender, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, company_name, rep_full_name, rep_email, contact_phone_e164, live_keys_enabled, is_demo FROM bi_lenders WHERE id = $1` /* BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 */,
    [req.lenderId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_found" });
  let user = null;
  if (req.lenderUserId) { const ur = await pool.query(`SELECT id, full_name, email, role FROM bi_lender_contacts WHERE id=$1 LIMIT 1`, [req.lenderUserId]); if (ur.rows[0]) user = ur.rows[0]; }
  res.json({ lender: r.rows[0], user });
});

router.post("/lender/api-keys", authLender, lenderRateLimit, /* BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1 */ async (req: any, res) => {
  const mode = req.body?.mode === "live" ? "live" : "test";
  // BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 — live keys gated by staff approval.
  if (mode === "live") {
    const lr = await pool.query<{ live_keys_enabled: boolean | null }>(
      `SELECT live_keys_enabled FROM bi_lenders WHERE id = $1 LIMIT 1`,
      [req.lenderId],
    );
    if (lr.rows[0]?.live_keys_enabled !== true) {
      return res.status(403).json({
        error: "live_keys_not_enabled",
        message: "Live key minting requires staff approval. Use POST /lender/api-keys/request-live to ask.",
      });
    }
  }
  const prefix = mode === "live" ? "bk_live_" : "bk_test_";
  const wire = `${prefix}${crypto.randomBytes(6).toString("hex")}.${crypto.randomBytes(24).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(wire).digest("hex");
  const inserted = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO bi_lender_api_keys (lender_id, key_hash, key_prefix, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, created_at` /* BI_SERVER_BLOCK_v245_LIVE_TEST_FIXES_PT2_v1 */,
    [req.lenderId, hash, prefix],
  );
  return res.status(201).json({ id: inserted.rows[0]?.id, created_at: inserted.rows[0]?.created_at, mode, secret: wire });
});

// BI_SERVER_BLOCK_v245_LIVE_TEST_FIXES_PT2_v1 — GET /lender/api-keys
router.get("/lender/api-keys", authLender, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, key_prefix, is_active, last_used_at, created_at
       FROM bi_lender_api_keys
      WHERE lender_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC`,
    [req.lenderId],
  );
  res.json({ items: r.rows });
});

// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 — lender asks staff for live-key approval.
router.post("/lender/api-keys/request-live", authLender, lenderRateLimit, /* BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1 */ async (req: any, res) => {
  const r = await pool.query<{ company_name: string; contact_full_name: string | null; contact_phone_e164: string | null; live_keys_enabled: boolean | null }>(
    `SELECT company_name, contact_full_name, contact_phone_e164, live_keys_enabled FROM bi_lenders WHERE id = $1 LIMIT 1`,
    [req.lenderId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_found" });
  if (r.rows[0].live_keys_enabled === true) return res.json({ ok: true, already_enabled: true });
  await pool.query(
    `INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta)
     VALUES (NULL, 'lender', 'live_keys_requested', $1, $2::jsonb)`,
    [`${r.rows[0].company_name} requested live API key access`, JSON.stringify({ lender_id: req.lenderId, contact_phone: r.rows[0].contact_phone_e164 })],
  ).catch(() => {});
  void notifyStaff(
    "new_application",
    `BI live-key request: ${r.rows[0].company_name} (${r.rows[0].contact_full_name || "no contact"}). Approve in BF-portal Lender Management.`,
  ).catch(() => {});
  return res.json({ ok: true, requested: true });
});

router.get("/lender/applications/mine", authLender, async (req: any, res) => {
  const r = await pool.query(
    `SELECT id, public_id, application_code, status,
              business_name, company_name, guarantor_name,
              loan_amount, pgi_limit, annual_premium,
              pgi_application_id, score_decision,
              carrier_received_at, carrier_last_event, carrier_last_event_at,
              is_demo,
              created_at, updated_at
       FROM bi_applications
       -- BI_SERVER_BLOCK_v206_LENDER_PIPELINE_COLUMN_FIX_v1 - column is created_by_lender_id per FK constraint.
       -- BI_SERVER_BLOCK_v223_LENDER_CARRIER_FORWARDING_v1 - surface application_code + pgi_application_id + company_name.
       -- BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1 - surface carrier_received_at + carrier_last_event(_at).
       -- BI_SERVER_BLOCK_v244_LIVE_TEST_FIXES_v1 - drop core_inputs from pipeline SELECT; not needed for cards, and the migration adds it idempotently anyway.
       WHERE created_by_lender_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
    [req.lenderId],
  );
  res.json({ applications: r.rows });
});


// BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1 — lender-scoped timeline.
router.get("/lender/applications/:code/timeline", authLender, async (req: any, res) => {
  const { code } = req.params;
  const ownerCheck = await pool.query(
    `SELECT id FROM bi_applications WHERE application_code = $1 AND created_by_lender_id = $2 LIMIT 1`,
    [code, req.lenderId],
  );
  const row = ownerCheck.rows[0];
  if (!row) return res.status(404).json({ error: "not_found" });
  const activity = await pool.query(
    `SELECT event_type, summary, meta, created_at
       FROM bi_activity
      WHERE application_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [row.id],
  );
  res.json({ application_code: code, events: activity.rows });
});

export default router;
