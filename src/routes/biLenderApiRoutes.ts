import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit"; // BI_SERVER_BLOCK_v236_RATE_LIMIT_AND_ADVISORY_LOCK_v1
import { notifyStaff } from "../services/staffNotifyService"; // BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1
import { pool } from "../db";
import { env } from "../platform/env";
import { pgiScore, pgiSubmit } from "../services/pgiAdapter"; // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1
// BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1 — typed wrappers
import { sendOtpSafe, verifyOtpSafe, sendEmailOtpSafe, verifyEmailOtpSafe } from "../services/otpService";
// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
import { normalizeE164 } from "../util/phoneE164";
import { generatePublicId } from "../util/publicId";
// BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1 -- needed by the new
// POST /lender/applications/:code/documents endpoint below.
import multer from "multer";
import { getStorage } from "../lib/storage";
import { validatePgiSubmissionV2 } from "../lib/validation/pgiFields";
import { buildCarrierPayloadV2 } from "../services/pgiCarrierMapper";

const router = Router();

// BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1
// Multer instance for lender uploads. Same 5MB-per-file cap as
// the public docs endpoint (biPublicApplicationRoutes.ts:354) to
// stay consistent with PGI carrier policy.
const lenderDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
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
        if (claims.user_id || claims.contactId) req.lenderUserId = String(claims.user_id || claims.contactId);
        // BI_SERVER_BLOCK_v242_PIPELINE_AND_REMINDERS_v1 — surface is_demo
        // claim so per-route handlers can scope pipeline queries to the
        // lender's current session mode. Demo sessions see ONLY demo
        // apps; real sessions never see demo apps.
        req.isDemo = claims.is_demo === true;
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

// BI_SERVER_BLOCK_v354_LENDER_API_CARRIER_ALIGNMENT_v1
function normalizeLenderBody(input: any): { flat: Record<string, any>; declarations: Record<string, any>; co_guarantors: any[]; shape: "legacy" | "v2" } {
  if (!input || typeof input !== "object") return { flat: {}, declarations: {}, co_guarantors: [], shape: "legacy" };
  if (input.guarantor && typeof input.guarantor === "object") {
    const g = input.guarantor || {};
    const biz = input.business || {};
    const loan = input.loan || {};
    const fin = input.financials || {};
    const flat: Record<string, any> = {
      country: biz.country || "CA",
      q0_country: biz.country === "US" ? "United States" : "Canada",
      q2_full_name: g.name ?? "", guarantor_name: g.name ?? "",
      q4_date_of_birth: g.dob ?? "",
      q7_email: g.email ?? "", guarantor_email: g.email ?? "",
      q5_residential_address: g.address ?? "",
      q_ca_id_type: g.q_ca_id_type ?? "", q_ca_id_number: g.q_ca_id_number ?? "",
      q15_business_legal_name: input.company_name ?? input.business_name ?? "",
      business_name: input.company_name ?? input.business_name ?? "",
      q17_business_operating_address: biz.address ?? "", q_business_province: biz.province ?? "",
      q25_naics_code: biz.naics ?? "", naics_code: biz.naics ?? "",
      q26_formation_date: biz.start_date ?? biz.formation_date ?? "", formation_date: biz.start_date ?? biz.formation_date ?? "",
      q41_loan_amount: Number(loan.amount) || 0, loan_amount: Number(loan.amount) || 0,
      q42_pgi_limit: Number(loan.pgi_limit) || 0, pgi_limit: Number(loan.pgi_limit) || 0,
      q_ca_loan_type: loan.q_ca_loan_type ?? "",
      annual_revenue: Number(fin.revenue_last_year ?? fin.annual_revenue) || 0,
      ebitda: Number(fin.ebitda_last_year ?? fin.ebitda) || 0,
      total_debt: Number(fin.total_debt) || 0,
      monthly_debt_service: Number(fin.monthly_payments ?? fin.monthly_debt_service) || 0,
      collateral_value: Number(fin.collateral_value) || 0,
      enterprise_value: Number(fin.enterprise_value) || 0,
      lender_name: input.lender_name ?? null, loan_funding_date: loan.loan_funding_date ?? null,
      policy_start_date: loan.policy_start_date ?? null, use_of_proceeds: loan.use_of_proceeds ?? null,
      guarantor_phone: g.phone ?? "",
    };
    return { flat, declarations: input.declarations || {}, co_guarantors: Array.isArray(input.co_guarantors) ? input.co_guarantors : [], shape: "v2" };
  }
  return { flat: { ...input }, declarations: {}, co_guarantors: [], shape: "legacy" };
}

router.post("/lender/applications", authLender, lenderRateLimit, /* v236 */ async (req: any, res) => {
  const norm = normalizeLenderBody(req.body ?? {});
  const b = norm.flat;
  // BI_SERVER_BLOCK_v362_LEGACY_SUNSET_AND_STUB_GUARD_v1
  // Legacy flat shape is no longer accepted. v354 promised it would still
  // work with a Deprecation header, but the v2 validator requires 11
  // declarations the legacy shape can't provide — every legacy request
  // 400'd anyway. Return 410 Gone with a clear migration path instead
  // of leaving callers guessing why validation fails.
  if (norm.shape === "legacy") {
    return res.status(410).json({
      error: "legacy_shape_removed",
      message: "The flat v1 payload shape is no longer accepted. Migrate to the nested v2 shape.",
      docs: "https://www.boreal.insure/lender/api",
      openapi: "https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net/api/v1/lender/openapi.json",
      since: "2026-05-26",
    });
  }
  const v2Envelope = { form_data: {
    q0_country: b.q0_country || (b.country === "US" ? "United States" : "Canada"),
    q2_full_name: b.q2_full_name || b.guarantor_name,
    q4_date_of_birth: b.q4_date_of_birth, q7_email: b.q7_email || b.guarantor_email,
    q5_residential_address: b.q5_residential_address,
    q_ca_id_type: b.q_ca_id_type, q_ca_id_number: b.q_ca_id_number,
    q15_business_legal_name: b.q15_business_legal_name || b.business_name,
    q17_business_operating_address: b.q17_business_operating_address,
    q_business_province: b.q_business_province,
    q25_naics_code: b.q25_naics_code || b.naics_code,
    q26_formation_date: b.q26_formation_date || b.formation_date,
    q_ca_loan_type: b.q_ca_loan_type,
    q41_loan_amount: Number(b.q41_loan_amount || b.loan_amount),
    q42_pgi_limit: Number(b.q42_pgi_limit || b.pgi_limit),
    ...(norm.declarations || {}),
  } };
  const v = validatePgiSubmissionV2(v2Envelope);
  if (!v.ok) return res.status(400).json({ error: "validation_failed", issues: v.issues, shape: norm.shape, hint: undefined });

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
  const derivedBankruptcy = (norm.declarations?.section_1_2 === "yes");
  const derivedInsolvency = (norm.declarations?.section_2_b === "yes");
  const derivedJudgment = (norm.declarations?.section_2_d === "yes");
  const fullFormData = { ...b, declarations: norm.declarations || {}, co_guarantors: norm.co_guarantors || [] };
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
     derivedBankruptcy, derivedInsolvency, derivedJudgment,
     score.score_id, ("score" in score) ? score.score : null, score.decision,
     fullFormData,
     req.lenderUserId ?? null]);

  if (norm.co_guarantors && norm.co_guarantors.length > 0) {
    for (const cg of norm.co_guarantors) {
      try {
        await pool.query(`INSERT INTO bi_co_guarantors
             (application_id, first_name, last_name, email, date_of_birth, phone,
              address, city, province, postal_code, relationship)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, cg.first_name || "", cg.last_name || "", cg.email || null, cg.date_of_birth || null, cg.phone || null, cg.address || null, cg.city || null, cg.province || null, cg.postal_code || null, cg.relationship || "Guarantor"]);
      } catch (err) {
        console.warn("[v354] co_guarantor insert failed", { application_id: id, error: (err as Error).message });
      }
    }
  }

  // BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1
  // Populate application_code so the row can be looked up by code
  // post-creation. Migration v227 added the column + backfilled
  // existing rows from public_id, but every INSERT path needs to
  // set it explicitly for new rows -- the migration is one-shot.
  // public_id is reused as the code value: it's already generated,
  // already unique (Crockford 8-char), and the v227 backfill set
  // the precedent that they're interchangeable. Future codes can
  // diverge from public_id once we have a separate generator.
  await pool.query(
    `UPDATE bi_applications SET application_code = public_id WHERE id = $1 AND application_code IS NULL`,
    [id]
  ).catch((err: any) => {
    // eslint-disable-next-line no-console
    console.warn("lender.applications.application_code_backfill_failed", {
      id, message: err?.message, code: err?.code,
    });
  });

  // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1 — BUG #1 fix: auto-forward to carrier after
  let lenderCompanyName: string | null = null;
  let lenderIsDemo = false;
  try {
    const lr = await pool.query(`SELECT company_name, is_demo FROM bi_lenders WHERE id = $1 LIMIT 1`, [req.lenderId]);
    lenderCompanyName = (lr.rows[0]?.company_name as string | undefined) || null;
    lenderIsDemo = lr.rows[0]?.is_demo === true;
  } catch {}
  // BI_SERVER_BLOCK_v358_CARRIER_ENVELOPE_FIX_v1
  const carrierRowSnapshot = { id, public_id: publicId, guarantor_name: b.guarantor_name, guarantor_email: b.guarantor_email, business_name: b.business_name, lender_name: lenderCompanyName ?? b.lender_name ?? undefined, country: b.country, naics_code: b.naics_code, formation_date: b.formation_date, loan_amount: b.loan_amount, pgi_limit: b.pgi_limit, annual_revenue: b.annual_revenue, ebitda: b.ebitda, total_debt: b.total_debt, monthly_debt_service: b.monthly_debt_service, collateral_value: b.collateral_value, enterprise_value: b.enterprise_value, q4_date_of_birth: b.q4_date_of_birth, q7_email: b.q7_email || b.guarantor_email, q5_residential_address: b.q5_residential_address, q_ca_id_type: b.q_ca_id_type, q_ca_id_number: b.q_ca_id_number, q17_business_operating_address: b.q17_business_operating_address, q_business_province: b.q_business_province, q_ca_loan_type: b.q_ca_loan_type, form_data: fullFormData, declarations: norm.declarations || {} };
  const carrierRequestBody: any = buildCarrierPayloadV2(
    carrierRowSnapshot as any,
    fullFormData as any,
    (norm.declarations || {}) as any,
    {
      guarantor_name: b.guarantor_name,
      guarantor_email: b.guarantor_email || b.q7_email,
      business_name: b.business_name,
      lender_name: lenderCompanyName ?? b.lender_name ?? null,
    }
  );
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

  // BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1 -- include
  // application_code in the response so the frontend (BI-Website
  // src/pages/LenderApplicationNew.tsx:84) can use it for the
  // follow-up document upload.
  return res.status(201).json({
    public_id: publicId,
    application_id: id,
    application_code: publicId,
    status: pgi_application_id ? "submitted" : "ready_for_submission",
    score_id: score.score_id,
    score: "score" in score ? score.score : null,
    pgi_application_id,
    pgi_status,
    pgi_error,
  });
});

router.get("/lender/applications", authLender, async (req: any, res) => {
  // BI_SERVER_BLOCK_v242_PIPELINE_AND_REMINDERS_v1 — demo sessions see
  // ONLY demo-flagged apps; real sessions never see demo apps. The
  // is_demo column on bi_applications was added in v226; it's already
  // populated correctly on INSERT for lender submissions. The bug was
  // that the pipeline GET ignored it, so demo submissions appeared in
  // the real lender's pipeline (and vice versa) until the user reloaded.
  const demoFilter = req.isDemo === true ? "AND is_demo IS TRUE" : "AND is_demo IS NOT TRUE";
  const r = await pool.query(`SELECT id, status, business_name, loan_amount, pgi_limit, annual_premium, quote_id, underwriter_ref, created_at, updated_at FROM bi_applications WHERE lender_id=$1 ${demoFilter} ORDER BY updated_at DESC LIMIT 200`, [req.lenderId]);
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
  // BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1
  // Channel can be implicit (phone present → sms, email present → email)
  // or explicit via channel:"sms"|"email". Lenders captured in the build-
  // a-lender form may not have phones and may prefer email.
  const phoneRaw = req.body?.phone;
  const emailRaw = req.body?.email;
  const channel = String(req.body?.channel ?? "").toLowerCase();
  const wantsEmail = channel === "email" || (!phoneRaw && typeof emailRaw === "string" && emailRaw.includes("@"));

  if (wantsEmail) {
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    // Look up login contact by email.
    const contact = await pool.query(
      `SELECT c.id FROM bi_lender_login_contacts c
         JOIN bi_lenders l ON l.id = c.lender_id
        WHERE LOWER(c.email) = $1 AND c.is_active = TRUE AND l.is_active = TRUE
        LIMIT 1`,
      [email],
    );
    if (contact.rows[0]) {
      const sr = await sendEmailOtpSafe(email);
      if (!sr.ok) return res.status(502).json({ error: "otp_send_failed", detail: sr.error });
    }
    return res.json({ ok: true, channel: "email" });
  }

  // SMS path — original behaviour.
  const phone = normalizeE164(phoneRaw);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  const r = await pool.query(
    `SELECT c.id FROM bi_lender_login_contacts c JOIN bi_lenders l ON l.id = c.lender_id WHERE c.phone_e164 = $1 AND c.is_active = TRUE AND l.is_active = TRUE LIMIT 1`,
    [phone],
  );
  if (r.rows[0]) {
    const sr = await sendOtpSafe(phone);
    if (!sr.ok) return res.status(502).json({ error: "otp_send_failed", detail: sr.error });
  }
  res.json({ ok: true, channel: "sms" });
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
  // BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1 — accept email or phone.
  const code = String(req.body?.code ?? "").trim();
  if (!code) return res.status(400).json({ error: "missing_code" });

  const emailRaw = req.body?.email;
  const channel = String(req.body?.channel ?? "").toLowerCase();
  const isEmail = channel === "email" || (typeof emailRaw === "string" && emailRaw.includes("@"));
  if (isEmail) {
    const email = String(emailRaw).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "invalid_email" });
    const vr = await verifyEmailOtpSafe(email, code);
    if (!vr.ok) return res.status(502).json({ error: "otp_verify_failed", detail: vr.error });
    if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });

    let row: any;
    const cr = await pool.query(
      `SELECT c.id AS contact_id, l.id AS lender_id, l.company_name, c.full_name, c.email, c.role
         FROM bi_lender_login_contacts c JOIN bi_lenders l ON l.id = c.lender_id
        WHERE LOWER(c.email) = $1 AND c.is_active = TRUE AND l.is_active = TRUE LIMIT 1`,
      [email],
    );
    if (cr.rows[0]) row = cr.rows[0];
    if (!row) return res.status(404).json({ error: "lender_not_found" });

    const secret = process.env.JWT_SECRET || "dev-missing-jwt-secret";
    const token = jwt.sign(
      { kind: "lender", id: row.lender_id, contactId: row.contact_id, role: row.role },
      secret,
      { expiresIn: "12h" },
    );
    return res.json({ token, channel: "email", lender: { id: row.lender_id, company_name: row.company_name }, user: { id: row.contact_id, full_name: row.full_name, email: row.email, role: row.role } });
  }

  // Phone path — original logic preserved below.
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });

  let row: any;
  const cr = await pool.query(`SELECT c.id AS contact_id, l.id AS lender_id, l.company_name, c.full_name, c.email, c.role FROM bi_lender_login_contacts c JOIN bi_lenders l ON l.id=c.lender_id WHERE c.phone_e164=$1 AND c.is_active=TRUE AND l.is_active=TRUE LIMIT 1`, [phone]);
  if (cr.rows[0]) row = cr.rows[0];
  if (!row) return res.status(401).json({ error: "phone_not_registered" });
  // BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1
  const vr = await verifyOtpSafe(phone, code);
  if (!vr.ok) return res.status(502).json({ error: "otp_verify_failed", detail: vr.error });
  if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });
  const token = jwt.sign({ kind: "lender", id: row.lender_id, user_id: row.contact_id }, env.JWT_SECRET || "dev-missing-jwt-secret", { expiresIn: "7d" });
  res.json({ token, lender: { id: row.lender_id, company_name: row.company_name }, user: { id: row.contact_id, full_name: row.full_name, email: row.email, role: row.role } });
});

async function requireLenderAdmin(req: any, res: any, next: any) {
  if (!req.lenderUserId) return res.status(403).json({ error: "lender_admin_required" });
  const r = await pool.query(`SELECT role FROM bi_lender_login_contacts WHERE id=$1 AND lender_id=$2 AND is_active=TRUE LIMIT 1`, [req.lenderUserId, req.lenderId]);
  if (r.rows[0]?.role !== "admin") return res.status(403).json({ error: "lender_admin_required" });
  return next();
}

router.get("/lender/contacts", authLender, async (req: any, res) => {
  const r = await pool.query(`SELECT id, lender_id, email, phone_e164, full_name, role, is_active, created_at, updated_at FROM bi_lender_login_contacts WHERE lender_id=$1 AND is_active=TRUE ORDER BY created_at DESC`, [req.lenderId]);
  return res.json({ contacts: r.rows });
});

router.post("/lender/contacts", authLender, requireLenderAdmin, async (req: any, res) => {
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = normalizeE164(req.body?.phone_e164);
  const full_name = typeof req.body?.full_name === "string" ? req.body.full_name.trim() : null;
  const role = typeof req.body?.role === "string" ? req.body.role.trim() : "member";
  const email = emailRaw || null;
  if (!email && !phone) return res.status(400).json({ error: "email_or_phone_required" });
  const r = await pool.query(`INSERT INTO bi_lender_login_contacts (lender_id, email, phone_e164, full_name, role, is_active) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, lender_id, email, phone_e164, full_name, role, is_active, created_at, updated_at`, [req.lenderId, email, phone, full_name, role]);
  return res.status(201).json({ contact: r.rows[0] });
});

router.patch("/lender/contacts/:id", authLender, requireLenderAdmin, async (req: any, res) => {
  const id = String(req.params.id);
  const sets: string[] = [];
  const vals: any[] = [id, req.lenderId];
  let i = 3;
  if (req.body?.email !== undefined) { sets.push(`email=$${i++}`); vals.push(String(req.body.email || "").trim().toLowerCase() || null); }
  if (req.body?.phone_e164 !== undefined) { sets.push(`phone_e164=$${i++}`); vals.push(normalizeE164(req.body.phone_e164)); }
  if (req.body?.full_name !== undefined) { sets.push(`full_name=$${i++}`); vals.push(String(req.body.full_name || "").trim() || null); }
  if (req.body?.role !== undefined) { sets.push(`role=$${i++}`); vals.push(String(req.body.role || "").trim() || null); }
  if (req.body?.is_active !== undefined) { sets.push(`is_active=$${i++}`); vals.push(Boolean(req.body.is_active)); }
  if (!sets.length) return res.status(400).json({ error: "no_fields" });
  sets.push(`updated_at=NOW()`);
  const q = `UPDATE bi_lender_login_contacts SET ${sets.join(", ")} WHERE id=$1 AND lender_id=$2 RETURNING id, lender_id, email, phone_e164, full_name, role, is_active, created_at, updated_at`;
  const r = await pool.query(q, vals);
  if (!r.rows[0]) return res.status(404).json({ error: "contact_not_found" });
  return res.json({ contact: r.rows[0] });
});

// BI_SERVER_BLOCK_v303_LENDER_DEMO_CLEANUP_v1 — DELETE demo applications
// created by the current lender during the current demo session. Operator
// brief: "DELETE rows on Exit demo (not hide), session-aware so Andrew
// running 10 demos/day doesn't accumulate."
router.post("/lender/demo/cleanup", authLender, async (req: any, res: any) => {
  const lenderId = req?.lenderId ?? null;
  if (!lenderId) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const startedAtRaw = String(req.body?.session_started_at ?? "").trim();
  const startedAt = new Date(startedAtRaw);
  if (!startedAtRaw || Number.isNaN(startedAt.getTime())) {
    return res.status(400).json({ ok: false, error: "session_started_at_required" });
  }
  // Hard delete; FK CASCADE cleans up bi_documents, bi_activity, etc.
  const r = await pool.query<{ id: string }>(
    `DELETE FROM bi_applications
      WHERE is_demo = TRUE
        AND created_by_lender_id = $1::uuid
        AND created_at >= $2::timestamptz
      RETURNING id`,
    [lenderId, startedAt.toISOString()],
  );
  return res.status(200).json({ ok: true, deleted: r.rows.length });
});

router.delete("/lender/contacts/:id", authLender, requireLenderAdmin, async (req: any, res) => {
  const r = await pool.query(`UPDATE bi_lender_login_contacts SET is_active=FALSE, updated_at=NOW() WHERE id=$1 AND lender_id=$2 RETURNING id`, [req.params.id, req.lenderId]);
  if (!r.rows[0]) return res.status(404).json({ error: "contact_not_found" });
  return res.json({ ok: true });
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
  // BI_SERVER_BLOCK_v258_APPLICATION_SCHEMA_FIX_v1
  // bi_applications has no company_name column; it's normalized into
  // bi_companies via company_id. LEFT JOIN so applications without
  // a linked company still appear.
  const r = await pool.query(
    `SELECT a.id, a.public_id, a.application_code, a.status,
            a.business_name, c.legal_name AS company_name, a.guarantor_name,
            a.loan_amount, a.pgi_limit, a.annual_premium,
            a.pgi_application_id, a.score_decision,
            a.carrier_received_at, a.carrier_last_event, a.carrier_last_event_at,
            a.is_demo,
            a.created_at, a.updated_at
       FROM bi_applications a
       LEFT JOIN bi_companies c ON c.id = a.company_id
       WHERE a.created_by_lender_id = $1
       ORDER BY a.created_at DESC
       LIMIT 500`,
    [req.lenderId],
  );
  res.json({ applications: r.rows });
});


// BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1 — lender-scoped timeline.
// BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1
// POST /lender/applications/:code/documents
// Lender uploads documents for an application they own. Multer
// parses multipart bodies with `files` (multi) + `doc_types`
// (parallel index). Each file is persisted to blob storage and
// then to bi_documents with uploaded_by_actor='lender'. Behaves
// like the public docs handler (biPublicApplicationRoutes.ts:359)
// minus the score_decision gate -- lender apps don't go through
// the score-approve gate, they're carrier-direct.
router.post(
  "/lender/applications/:code/documents",
  authLender,
  lenderRateLimit,
  lenderDocUpload.array("files"),
  async (req: any, res: any) => {
    const ALLOWED_DOC_TYPES = new Set(["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"]);
    const docTypesRaw = Array.isArray(req.body?.doc_types) ? req.body.doc_types : req.body?.doc_types ? [req.body.doc_types] : [];
    const invalidDocType = docTypesRaw.find((t: string) => !ALLOWED_DOC_TYPES.has(String(t).trim()));
    if (invalidDocType) return res.status(400).json({ error: "invalid_doc_type", invalid_value: invalidDocType, allowed: Array.from(ALLOWED_DOC_TYPES) });

    const code = String(req.params.code ?? "").trim();
    if (!code) return res.status(400).json({ error: "missing_code" });

    // Ownership + state check. application_code lookup also catches
    // public_id (post-v227 backfill they're equal); created_by_lender_id
    // ensures lenders can't upload to each other's apps.
    const ownerCheck = await pool.query(
      `SELECT id, status FROM bi_applications
        WHERE application_code = $1 AND created_by_lender_id = $2
        LIMIT 1`,
      [code, req.lenderId],
    );
    const app = ownerCheck.rows[0];
    if (!app) return res.status(404).json({ error: "not_found" });

    // Status gate: uploads allowed in ready_for_submission OR submitted.
    // Beyond that (document_review / under_review / approved / declined /
    // policy_issued) staff own the document set. Reject 409 with the
    // current status so the frontend can surface a clear error.
    const status = String(app.status ?? "").toLowerCase();
    if (status !== "ready_for_submission" && status !== "submitted") {
      return res.status(409).json({
        error: "wrong_status",
        current: status,
        message: "Lender document upload only allowed in ready_for_submission or submitted",
      });
    }

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "no_files" });

    const rawDocTypesForFiles = req.body?.doc_types;
    const docTypes = Array.isArray(rawDocTypesForFiles)
      ? docTypesRaw
      : typeof rawDocTypesForFiles === "string" ? [rawDocTypesForFiles] : [];

    const store = getStorage();
    const created: Array<{ id: string; doc_type: string; filename: string }> = [];

    for (const [idx, file] of files.entries()) {
      const docType = typeof docTypes[idx] === "string" && docTypes[idx].trim()
        ? docTypes[idx].trim()
        : "other";

      let put;
      try {
        put = await store.put({
          buffer: file.buffer,
          filename: file.originalname,
          contentType: file.mimetype,
          pathPrefix: `applications/${app.id}`,
        });
      } catch (err) {
        return res.status(502).json({
          error: "storage_failed",
          detail: String((err as Error)?.message ?? err),
        });
      }

      let inserted;
      try {
        inserted = await pool.query(
          `INSERT INTO bi_documents
             (application_id, doc_type, original_filename, storage_key,
              blob_name, blob_url, sha256_hash, mime_type, bytes,
              uploaded_by_actor, uploaded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'lender', $10)
           RETURNING id`,
          [
            app.id, docType, file.originalname, put.blobName,
            put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes,
            req.lenderUserId ?? null,
          ],
        );
      } catch (err) {
        return res.status(400).json({
          error: "invalid_doc_type",
          doc_type: docType,
          detail: String((err as Error)?.message ?? err),
        });
      }

      created.push({
        id: inserted.rows[0].id as string,
        doc_type: docType,
        filename: file.originalname,
      });

      // BI_SERVER_BLOCK_v359_PGI_DOC_FORWARDING_v1
      // Forward to PGI if the application has already been submitted to
      // the carrier (pgi_application_id is set). If not, defer — the docs
      // will be flushed when staff or the auto-submit path posts the app
      // to PGI. Tracked via bi_documents.pgi_document_id (added below).
      try {
        const appRow = await pool.query<{ pgi_application_id: string | null }>(
          `SELECT pgi_application_id FROM bi_applications WHERE id = $1 LIMIT 1`,
          [app.id]
        );
        const pgiAppId = appRow.rows[0]?.pgi_application_id ?? null;
        if (pgiAppId && ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"].includes(docType)) {
          const { pgiUploadDocument } = await import("../services/pgiAdapter");
          const fwdResult = await pgiUploadDocument({
            pgiApplicationId: pgiAppId,
            docType: docType as any,
            filename: file.originalname,
            buffer: file.buffer,
            mimeType: file.mimetype,
          });
          await pool.query(
            `UPDATE bi_documents SET pgi_document_id = $1, forwarded_to_carrier_at = NOW() WHERE id = $2`,
            [fwdResult.document_id, inserted.rows[0].id]
          ).catch((e: any) => console.warn("[v359] update bi_documents.pgi_document_id failed", { id: inserted.rows[0].id, e: e?.message }));
        }
      } catch (err) {
        console.warn("[v359] pgi_doc_forward_failed", { app_id: app.id, doc_type: docType, error: (err as Error).message });
        // Non-fatal — doc is already in our storage. Staff can manually re-forward later.
      }

      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
         VALUES($1, 'lender', 'document_uploaded', $2)`,
        [app.id, `Lender uploaded document: ${file.originalname}`],
      ).catch(() => { /* non-fatal, doc is already stored */ });
    }

    return res.status(200).json({ ok: true, documents: created });
  },
);

// BI_SERVER_BLOCK_BI_ROUND7_LENDER_DOCS_v1
// GET /lender/applications/:code/documents
// List documents for a lender's application. Excludes purged rows
// (purged_at IS NULL) so post-decision purged docs don't leak.
router.get(
  "/lender/applications/:code/documents",
  authLender,
  async (req: any, res: any) => {
    const code = String(req.params.code ?? "").trim();
    if (!code) return res.status(400).json({ error: "missing_code" });

    const ownerCheck = await pool.query(
      `SELECT id FROM bi_applications
        WHERE application_code = $1 AND created_by_lender_id = $2
        LIMIT 1`,
      [code, req.lenderId],
    );
    const app = ownerCheck.rows[0];
    if (!app) return res.status(404).json({ error: "not_found" });

    const docs = await pool.query(
      `SELECT id, doc_type, original_filename, bytes, mime_type, created_at
         FROM bi_documents
        WHERE application_id = $1 AND purged_at IS NULL
        ORDER BY created_at DESC`,
      [app.id],
    );

    return res.status(200).json({
      application_code: code,
      documents: docs.rows.map((d: any) => ({
        id: d.id,
        doc_type: d.doc_type,
        filename: d.original_filename,
        bytes: Number(d.bytes ?? 0),
        mime_type: d.mime_type ?? null,
        created_at: d.created_at,
      })),
    });
  },
);

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
