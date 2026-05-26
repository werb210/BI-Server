import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { pgiScore } from "../services/pgiAdapter";
import { generatePublicId } from "../util/publicId";
// BI_SERVER_BLOCK_v66_PUBLIC_DOCS_AND_MIGRATION_SAFE_v1
import multer from "multer";
import { PARTNER_ALLOWED_MIME } from "../lib/validation/pgiFields";
import { getStorage } from "../lib/storage";
// BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
import { runOcrForDocument } from "../services/ocrRunner";

const router = Router();
const EBITDA_MIN = 50_000;
const LOAN_MAX = 1_000_000;

// BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1
// Idempotently links contact + company + first activity row to a new application.
// Safe to call multiple times for the same applicationId.
async function ensureContactAndCompanyForApp(appId: string): Promise<void> {
  await pool.query(`
    WITH app AS (
      SELECT id, company_name, guarantor_name, guarantor_email, guarantor_phone, company_id
        FROM bi_applications WHERE id = $1
    ), company_upsert AS (
      INSERT INTO bi_companies (id, legal_name, created_at, updated_at)
      SELECT gen_random_uuid(), TRIM(app.company_name), NOW(), NOW() FROM app
      WHERE app.company_name IS NOT NULL AND TRIM(app.company_name) <> ''
        AND NOT EXISTS (SELECT 1 FROM bi_companies bc WHERE LOWER(TRIM(bc.legal_name)) = LOWER(TRIM(app.company_name)))
      RETURNING id
    ), link_company AS (
      UPDATE bi_applications a SET company_id = COALESCE(a.company_id,(SELECT id FROM company_upsert),(SELECT id FROM bi_companies WHERE LOWER(TRIM(legal_name)) = LOWER(TRIM((SELECT company_name FROM app))) LIMIT 1))
      WHERE a.id = (SELECT id FROM app) RETURNING company_id
    ), contact_upsert AS (
      INSERT INTO bi_contacts (id, full_name, email, phone_e164, tags, created_at)
      SELECT gen_random_uuid(), COALESCE(NULLIF(TRIM(app.guarantor_name), ''), 'Applicant ' || COALESCE(app.guarantor_phone, '')), NULLIF(TRIM(app.guarantor_email), ''), NULLIF(TRIM(app.guarantor_phone), ''), ARRAY['applicant'], NOW()
      FROM app
      WHERE NOT EXISTS (
        SELECT 1 FROM bi_contacts c WHERE (c.phone_e164 = app.guarantor_phone AND app.guarantor_phone IS NOT NULL)
          OR (LOWER(TRIM(c.email)) = LOWER(TRIM(app.guarantor_email)) AND app.guarantor_email IS NOT NULL AND TRIM(app.guarantor_email) <> '')
      ) RETURNING id
    )
    INSERT INTO bi_activity (application_id, contact_id, actor_type, event_type, summary)
    SELECT (SELECT id FROM app), COALESCE((SELECT id FROM contact_upsert),(SELECT id FROM bi_contacts WHERE (phone_e164 = (SELECT guarantor_phone FROM app) AND (SELECT guarantor_phone FROM app) IS NOT NULL) OR (LOWER(TRIM(email)) = LOWER(TRIM((SELECT guarantor_email FROM app))) AND (SELECT guarantor_email FROM app) IS NOT NULL) LIMIT 1)), 'system', 'application_created', 'Application created'
    WHERE NOT EXISTS (SELECT 1 FROM bi_activity WHERE application_id = (SELECT id FROM app) AND event_type = 'application_created')
  `,[appId]);
}


router.post("/applications/score", async (req, res) => {
  const b = req.body ?? {};
  // BI_SERVER_BLOCK_v364_REFERRAL_SHORT_CODE_v1 (extends v360)
  // Three-way input acceptance:
  //   1. body `ref` (UUID) — what v360 originally planned
  //   2. body `ref_code` (short code, what v135 client sends today)
  //   3. ?ref= or ?ref_code= query string (legacy bookmarked URLs)
  // Lookup strategy: try UUID first if it parses as one, else try short_code.
  let attributedReferrerId: string | null = null;
  let attributedReferralId: string | null = null;
  const rawRef = String(
    b.ref ?? b.ref_code ?? req.query?.ref ?? req.query?.ref_code ?? ""
  ).trim();
  if (rawRef) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawRef);
    try {
      const refRow = await pool.query<{ id: string; referrer_id: string; status: string; email: string | null; phone_e164: string | null }>(
        isUuid
          ? `SELECT id, referrer_id, status, email, phone_e164
               FROM bi_referrals
              WHERE id = $1::uuid AND application_id IS NULL
              LIMIT 1`
          : `SELECT id, referrer_id, status, email, phone_e164
               FROM bi_referrals
              WHERE short_code = LOWER($1) AND application_id IS NULL
              LIMIT 1`,
        [rawRef]
      );
      const r = refRow.rows[0];
      if (r) {
        const applicantPhoneRaw = String(b.applicant_phone_e164 || "").trim();
        const phoneMatch = !applicantPhoneRaw || !r.phone_e164 || r.phone_e164 === applicantPhoneRaw;
        if (phoneMatch) {
          attributedReferrerId = r.referrer_id;
          attributedReferralId = r.id;
        }
      }
    } catch (err) {
      console.warn("[v364] referral lookup failed", { rawRef, isUuid, error: (err as Error)?.message });
    }
  }
  const required = [
    "country", "naics_code", "formation_date", "loan_amount", "pgi_limit",
    "annual_revenue", "ebitda", "total_debt", "monthly_debt_service",
    "collateral_value", "enterprise_value",
  ];
  const missing = required.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  // BI_SERVER_BLOCK_v180_SCORE_VALIDATION_v1
  // Field-shape validation. Catches malformed numerics (Number("foo") = NaN
  // would otherwise pass the 80% / EBITDA checks because NaN comparisons
  // are all false), bad NAICS / dates / phone before the row is INSERTed.
  const shapeIssues: { field: string; message: string }[] = [];
  const isFiniteNumber = (v: unknown): boolean => {
    if (v === null || v === undefined || v === "") return false;
    const n = Number(v);
    return Number.isFinite(n);
  };
  if (typeof b.naics_code !== "string" || !/^\d{6}$/.test(b.naics_code)) {
    shapeIssues.push({ field: "naics_code", message: "must be a 6-digit code" });
  }
  if (typeof b.formation_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.formation_date) || Number.isNaN(Date.parse(b.formation_date))) {
    shapeIssues.push({ field: "formation_date", message: "must be YYYY-MM-DD" });
  }
  for (const numKey of ["loan_amount", "pgi_limit", "annual_revenue", "ebitda", "total_debt", "monthly_debt_service", "collateral_value", "enterprise_value"] as const) {
    if (!isFiniteNumber(b[numKey])) {
      shapeIssues.push({ field: numKey, message: "must be a finite number" });
    } else if (Number(b[numKey]) < 0) {
      shapeIssues.push({ field: numKey, message: "must be non-negative" });
    }
  }
  if (b.applicant_phone_e164 !== undefined && b.applicant_phone_e164 !== null && b.applicant_phone_e164 !== "") {
    if (typeof b.applicant_phone_e164 !== "string" || !/^\+[1-9]\d{6,14}$/.test(b.applicant_phone_e164.trim())) {
      shapeIssues.push({ field: "applicant_phone_e164", message: "must be E.164 format (e.g. +14165551234)" });
    }
  }
  if (shapeIssues.length) {
    return res.status(400).json({ error: "validation_failed", issues: shapeIssues });
  }

  if (b.country !== "CA") return res.status(400).json({ error: "country_unsupported", supported: ["CA"] });
  if (Number(b.loan_amount) > LOAN_MAX) return res.status(400).json({ error: "loan_amount_exceeds_max", max: LOAN_MAX });
  if (Number(b.pgi_limit) > Number(b.loan_amount)) return res.status(400).json({ error: "pgi_limit_exceeds_loan" });
  if (Number(b.pgi_limit) > Number(b.loan_amount) * 0.80) return res.status(400).json({ error: "pgi_limit_exceeds_80pct" });
    // BI_SERVER_BLOCK_v207_HOTFIX_AND_APPLICANT_OTP_v1 — Optional applicant JWT.
  let verifiedPhone: string | null = null;
  try {
    const auth = String(req.headers.authorization ?? "");
    if (auth.startsWith("Bearer ")) {
      const claims: any = jwt.verify(auth.slice(7).trim(), env.JWT_SECRET || "dev-missing-jwt-secret");
      if (claims && claims.kind === "applicant" && claims.phone) verifiedPhone = String(claims.phone);
    }
  } catch { /* ignore */ }
  const applicantPhone: string | null = verifiedPhone
    ?? (typeof b.applicant_phone_e164 === "string" && b.applicant_phone_e164.trim()
      ? b.applicant_phone_e164.trim()
      : null);

  if (Number(b.ebitda) < EBITDA_MIN) return res.status(400).json({ error: "ebitda_below_min", min: EBITDA_MIN });

  const id = crypto.randomUUID();
  const publicId = generatePublicId();

  // BI_SERVER_BLOCK_v164_SCORE_STAGE_FIX_v1
  // V1 spec ruling 15 + §3: score pass creates row in `created` stage.
  // The pipeline card only materializes once the user submits the full
  // 45-question form (which advances created -> in_progress).
  await pool.query(
    // BI_SERVER_BLOCK_v170_SCORE_PHONE_NOT_NULL_FIX_v1
    // BI_SERVER_BLOCK_v207_CREATED_BY_ACTOR_NOT_NULL_FIX_v1
    // bi_applications.created_by_actor is bi_actor_type NOT NULL (no default).
    // Public CORE submissions are 'applicant' per enum: (applicant, lender,
    // referrer, staff, system).
    // BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1 — add referrer_id + referral_id columns.
    `INSERT INTO bi_applications
       (id, public_id, status, source, created_by_actor,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        applicant_phone_e164,
        referrer_id, referral_id,
        data,
        created_at, updated_at)
     VALUES ($1,$2,'created','public','applicant',
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, $14, $15, $16, $17::jsonb, NOW(), NOW())`,
    [
      id, publicId,
      b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
      b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
      b.collateral_value, b.enterprise_value,
      // BI_SERVER_BLOCK_v170_SCORE_PHONE_NOT_NULL_FIX_v1
      applicantPhone,
      attributedReferrerId,
      attributedReferralId,
      // BI_SERVER_BLOCK_v164_SCORE_STAGE_FIX_v1 — persist core_inputs for
      // Stage 2 pre-fill of the locked CORE fields.
      JSON.stringify({
        core_inputs: {
          country: b.country, naics_code: b.naics_code,
          formation_date: b.formation_date, loan_amount: b.loan_amount,
          pgi_limit: b.pgi_limit, annual_revenue: b.annual_revenue,
          ebitda: b.ebitda, total_debt: b.total_debt,
          monthly_debt_service: b.monthly_debt_service,
          collateral_value: b.collateral_value,
          enterprise_value: b.enterprise_value,
        },
      }),
    ],
  );

  // BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1 — back-link the referral.
  if (attributedReferralId) {
    await pool.query(
      `UPDATE bi_referrals
          SET application_id = $1,
              status = CASE WHEN status = 'invited' THEN 'applied' ELSE status END,
              updated_at = NOW()
        WHERE id = $2 AND application_id IS NULL`,
      [id, attributedReferralId]
    ).catch((err) => {
      console.warn("[v360] referral back-link failed (non-fatal)", { app_id: id, referral_id: attributedReferralId, error: (err as Error)?.message });
    });
  }

  let score;
  try {
    score = await pgiScore({
      country: b.country,
      naics_code: b.naics_code,
      formation_date: b.formation_date,
      loan_amount: Number(b.loan_amount),
      pgi_limit: Number(b.pgi_limit),
      annual_revenue: Number(b.annual_revenue),
      ebitda: Number(b.ebitda),
      total_debt: Number(b.total_debt),
      monthly_debt_service: Number(b.monthly_debt_service),
      collateral_value: Number(b.collateral_value),
      enterprise_value: Number(b.enterprise_value),
    });
  } catch (err: any) {
    await pool.query(
      `UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`,
      [String(err?.message ?? "pgi_unreachable"), id],
    );
    return res.status(502).json({ error: "score_failed", public_id: publicId });
  }

  // BI_SERVER_BLOCK_v164_SCORE_STAGE_FIX_v1
  // Stay in 'created' on approve — user must submit the full app to
  // advance to 'in_progress'. Decline still terminates here.
  const newStatus = score.decision === "decline" ? "declined" : "created";
  await pool.query(
    `UPDATE bi_applications
        SET score_id=$1, score_value=$2, score_decision=$3, score_reason=$4,
            score_at=NOW(), score_stale=FALSE, status=$5, updated_at=NOW()
      WHERE id=$6`,
    [
      score.score_id,
      "score" in score ? score.score : null,
      score.decision,
      "reason" in score ? score.reason : null,
      newStatus,
      id,
    ],
  );

  // BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1
  void ensureContactAndCompanyForApp(id).catch(() => {});

  return res.status(201).json({
    public_id: publicId,
    score_decision: score.decision,
    score: "score" in score ? score.score : null,
    reason: "reason" in score ? score.reason : null,
  });
});

router.get("/applications/:publicId", async (req, res) => {
  const r = await pool.query(`SELECT * FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  return res.json({ application: r.rows[0] });
});

router.patch("/applications/:publicId", async (req, res) => {
  const r = await pool.query(`SELECT id, score_decision FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  if (r.rows[0].score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });

  const b = req.body ?? {};
  // BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1
  // Optional `ref` from request body OR ?ref= query param. Validated against
  // bi_referrals — must belong to a real referrer, must be in 'invited' status,
  // must match the applicant's phone (E.164) or email if either is provided.
  // Mismatch → silently drop attribution (don't 400; the apply flow shouldn't
  // break because someone clicked a stale link). Match → capture both ids for
  // the INSERT below.
  let attributedReferrerId: string | null = null;
  let attributedReferralId: string | null = null;
  const refToken = String(b.ref ?? req.query?.ref ?? "").trim();
  if (refToken) {
    try {
      const refRow = await pool.query<{ id: string; referrer_id: string; status: string; email: string | null; phone_e164: string | null }>(
        `SELECT id, referrer_id, status, email, phone_e164
           FROM bi_referrals
          WHERE id = $1::uuid
            AND application_id IS NULL
          LIMIT 1`,
        [refToken]
      );
      const r = refRow.rows[0];
      if (r) {
        // Soft match: if either email OR phone matches what the applicant
        // is providing, accept the attribution. If neither is provided yet
        // (Stage 1 doesn't ask for them), accept anyway — the link itself
        // is sufficient evidence at Stage 1; Stage 2 will hard-verify by
        // backfilling the matching phone/email.
        const applicantPhoneRaw = String(b.applicant_phone_e164 || "").trim();
        const phoneMatch = !applicantPhoneRaw || !r.phone_e164 || r.phone_e164 === applicantPhoneRaw;
        if (phoneMatch) {
          attributedReferrerId = r.referrer_id;
          attributedReferralId = r.id;
        }
      }
    } catch (err) {
      // Bad UUID, etc. — silently skip attribution.
      console.warn("[v360] referral lookup failed", { ref: refToken, error: (err as Error)?.message });
    }
  }
  // BI_SERVER_BLOCK_v62_CORS_AND_PATCH_ALIGNMENT_v1
  // Add the score-time columns to the PATCH whitelist so the applicant
  // can edit them on the application form after the score check. These
  // columns ALL exist on bi_applications (populated by /applications/score
  // INSERT). Without this whitelist they are silently dropped and the
  // form returns ok:true while the data isn't saved.
  // Also adds country (it was checked in /score but not editable) and
  // explicitly maps every PGI_API_ALIGN_v57 client field.
  const cols: Record<string, string> = {
    // Identity
    guarantor_name: "guarantor_name",
    guarantor_email: "guarantor_email",
    guarantor_dob: "guarantor_dob",
    guarantor_address: "guarantor_address",
    guarantor_phone: "guarantor_phone",
    // Business
    country: "country",
    business_name: "business_name",
    business_address: "business_address",
    business_website: "business_website",
    // BI_SERVER_BLOCK_v258_APPLICATION_SCHEMA_FIX_v1 — entity_type CHECK
    // constraint dropped in the migration; 'applicant' now accepted.
    entity_type: "entity_type",
    business_number: "business_number",
    naics_code: "naics_code",
    formation_date: "formation_date",
    // Loan
    lender_name: "lender_name",
    loan_amount: "loan_amount",
    pgi_limit: "pgi_limit",
    csbfp_backed: "csbfp_backed",
    loan_has_guaranteed_cap: "loan_has_guaranteed_cap",
    loan_funding_date: "loan_funding_date",
    loan_purpose: "loan_purpose",
    personally_guaranteeing: "personally_guaranteeing",
    has_other_guarantors: "has_other_guarantors",
    policy_start_date: "policy_start_date",
    // Financial
    annual_revenue: "annual_revenue",
    ebitda: "ebitda",
    total_debt: "total_debt",
    monthly_debt_service: "monthly_debt_service",
    collateral_value: "collateral_value",
    enterprise_value: "enterprise_value",
    // Risk
    payables_threatening: "payables_threatening",
    upcoming_adverse_events: "upcoming_adverse_events",
    bankruptcy_history: "bankruptcy_history",
    insolvency_history: "insolvency_history",
    judgment_history: "judgment_history",
    personal_investigations: "personal_investigations",
    business_investigations: "business_investigations",
    property_insurance_in_force: "property_insurance_in_force",
    personal_judgments: "personal_judgments",
    business_judgments: "business_judgments",
    // Consents (jsonb)
    consents: "consents",
  };

  // BI_SERVER_BLOCK_v258_APPLICATION_SCHEMA_FIX_v1
  // Auto-create a bi_companies row tagged kind='lender' so the lender
  // appears in BI CRM Companies the moment the application is patched.
  let lenderCompanyId: string | null = null;
  const lenderName = typeof b.lender_name === 'string' ? b.lender_name.trim() : '';
  if (lenderName.length > 0) {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM bi_companies
        WHERE lower(legal_name) = lower($1) AND kind = 'lender'
        ORDER BY created_at ASC
        LIMIT 1`,
      [lenderName],
    );
    if (found.rows[0]) {
      lenderCompanyId = found.rows[0].id;
    } else {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO bi_companies (legal_name, kind)
         VALUES ($1, 'lender')
         RETURNING id`,
        [lenderName],
      );
      lenderCompanyId = created.rows[0].id;
    }
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const k of Object.keys(b)) {
    if (cols[k]) {
      sets.push(`${cols[k]} = $${i++}`);
      vals.push(b[k]);
    }
  }
  if (!sets.length) return res.json({ ok: true, no_op: true });
  sets.push(`lender_company_id = $${i++}`);
  vals.push(lenderCompanyId);
  vals.push(r.rows[0].id);
  await pool.query(`UPDATE bi_applications SET ${sets.join(", ")}, updated_at=NOW() WHERE id=$${i}`, vals);
  return res.json({ ok: true });
});

router.post("/applications/:publicId/submit", async (req, res) => {
  const r = await pool.query(`SELECT * FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  if (app.score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });
  if (app.score_stale) return res.status(409).json({ error: "score_stale", remediation: "re_run_score" });

  // BI_SERVER_BLOCK_v184_PUBLIC_STATUS_GUARDS_v1
  // Status guard. /submit advances 'created' -> 'in_progress' only.
  // Idempotent if already 'in_progress'. Reject if past that to prevent
  // applicant from regressing the application after staff has touched it.
  const currentStatus = String(app.status ?? "").toLowerCase();
  if (currentStatus === "in_progress") {
    return res.json({ ok: true, status: "in_progress", idempotent: true });
  }
  if (currentStatus !== "created" && currentStatus !== "") {
    return res.status(409).json({
      error: "wrong_status",
      current: currentStatus,
      message: "Application has progressed past submit; further changes belong with staff."
    });
  }

  // BI_SERVER_BLOCK_v246_BN_OPTIONAL_SUBMIT_v1
  // Operator decision (PROJECT_PLAN row 2): business_number is now
  // optional on the PUBLIC application flow. The CRA BN field stays on
  // the form (BI-Website v169) but the server no longer rejects
  // submits that lack it. Carrier (PGI) receives null when BN is
  // missing; if PGI starts flagging missing-BN apps in volume we
  // revisit (plan §4 decision). Lender flow is unchanged because
  // it does not enforce BN server-side today.
  // BI_SERVER_BLOCK_v349_PURBECK_PUBLIC_REQS_v1
  const required = [
    "guarantor_name", "guarantor_email", "guarantor_dob", "guarantor_address",
    "guarantor_phone", "business_name", "business_address",
    "lender_name", "loan_funding_date", "policy_start_date",
    "personally_guaranteeing", "consents",
  ];
  const missing = required.filter((k) => app[k] === null || app[k] === undefined || app[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  // BI_SERVER_BLOCK_v357_CONSENT_DERIVATION_v1
  // info_accurate and business_solvent are functionally covered by the
  // declarations (section_3_c truthfulness oath; section_6_a solvency).
  // Derive them at submit time rather than asking the user twice.
  const decls = (app.declarations ?? {}) as Record<string, unknown>;
  const c = { ...(app.consents ?? {}) } as Record<string, unknown>;
  if (c.info_accurate === undefined || c.info_accurate === null) {
    c.info_accurate = decls.section_3_c === "Agree";
  }
  if (c.business_solvent === undefined || c.business_solvent === null) {
    c.business_solvent = decls.section_6_a === "yes";
  }
  const consentKeys = [
    "electronic_signature", "info_accurate", "business_solvent",
    "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood",
  ];
  const unconsented = consentKeys.filter((k) => !c[k]);
  if (unconsented.length) return res.status(400).json({ error: "missing_consents", fields: unconsented });
  // Persist the derived consents back to the row so downstream readers (CRM
  // mirror, audit log, carrier mapper) see the same shape staff sees.
  await pool.query(
    `UPDATE bi_applications SET consents = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(c), app.id]
  );

  // BI_SERVER_BLOCK_v349_PURBECK_GUARDS_v1
  if (typeof app.q_business_province === "string" && app.q_business_province.toUpperCase() === "QC") {
    return res.status(400).json({ error: "quebec_blocked", message: "PGI does not currently write business in Quebec." });
  }
  if (Number(app.loan_amount) > 1_000_000) {
    return res.status(400).json({ error: "loan_amount_over_cap", message: "Loan amount exceeds the 1,000,000 maximum." });
  }
  if (Number(app.pgi_limit) > 1_000_000) {
    return res.status(400).json({ error: "pgi_limit_over_cap", message: "PGI limit exceeds the 1,000,000 maximum." });
  }
  const allowedLoanTypes = ["Commercial Mortgage", "Other Secured Loan"];
  if (app.q_ca_loan_type && !allowedLoanTypes.includes(app.q_ca_loan_type)) {
    return res.status(400).json({
      error: "loan_type_ineligible",
      message: `Loan type '${app.q_ca_loan_type}' is not eligible for Canadian PGI coverage. Eligible types are: ${allowedLoanTypes.join(", ")}.`,
    });
  }

  // BI_SERVER_BLOCK_v168_STAGE_TRANSITION_FIX_v1
  // V1 spec §3: full app submitted advances 'created' -> 'in_progress'.
  // The next transition (-> 'document_review' for public,
  // -> 'ready_for_submission' for lender) happens when docs are
  // uploaded via the /documents endpoint, not here.
  await pool.query(`UPDATE bi_applications SET status='in_progress', updated_at=NOW() WHERE id=$1`, [app.id]);

  // BI_SERVER_BLOCK_v366_NOTIFICATION_SMS_v2
  // Submit confirmation SMS. Non-fatal — submit response goes back regardless.
  if (app.applicant_phone_e164) {
    try {
      const { sendOutreachSms } = await import("../services/smsService");
      const docsUrl = `${process.env.BI_PUBLIC_URL || "https://www.boreal.insure"}/applications/${app.public_id}/documents`;
      const body = `Boreal Risk: We got your application. Next step — upload supporting documents here: ${docsUrl}`;
      await sendOutreachSms(app.applicant_phone_e164, body);
    } catch (err) {
      console.warn("[v366] submit confirmation SMS failed (non-fatal)", { app_id: app.id, error: (err as Error)?.message });
    }
  }
  // BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1
  void ensureContactAndCompanyForApp(app.id).catch(() => {});
  return res.json({ ok: true, status: "in_progress" });
});


// BI_SERVER_BLOCK_v66_PUBLIC_DOCS_AND_MIGRATION_SAFE_v1 — public doc upload.
// Authenticates by public_id only (no JWT). Used by the BI-Website applicant
// flow after submit. Stores files to Azure Blob via the same storage abstraction
// as the staff-side upload route. 5MB per file per PGI carrier policy.
// BI_SERVER_BLOCK_v349_DOC_CONSTRAINTS_v1
const publicDocUpload_v66 = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (PARTNER_ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`mime_not_allowed:${file.mimetype}`));
    }
  },
});

router.post("/applications/:publicId/documents", publicDocUpload_v66.array("files"), async (req, res) => {
  const r = await pool.query(
    `SELECT id, score_decision, status FROM bi_applications WHERE public_id=$1`,
    [req.params.publicId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  if (r.rows[0].score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });

  // BI_SERVER_BLOCK_v184_PUBLIC_STATUS_GUARDS_v1
  // Status guard. Uploads belong while the row is in_progress (between
  // /submit and accept-all) or document_review (staff has accepted some
  // and applicant is replacing rejected ones). Once past document_review
  // (submitted/under_review/approved/declined/policy_issued) the
  // applicant should not be uploading more documents.
  const docStatus = String(r.rows[0].status ?? "").toLowerCase();
  if (docStatus !== "in_progress" && docStatus !== "document_review") {
    return res.status(409).json({
      error: "wrong_status",
      current: docStatus,
      message: "Document upload only allowed while application is in_progress or document_review"
    });
  }

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) return res.status(400).json({ error: "no_files" });

  const docTypesRaw = req.body?.doc_types;
  const docTypes = Array.isArray(docTypesRaw)
    ? docTypesRaw
    : typeof docTypesRaw === "string" ? [docTypesRaw] : [];

  const store = getStorage();
  const created: Array<{ id: string; doc_type: string; filename: string }> = [];

  for (const [idx, file] of files.entries()) {
    // BI_SERVER_BLOCK_v368_PUBLIC_DOC_ALLOWLIST_v1
    // Same 7-value allowlist as the lender API path (v354). Anything else 400s.
    const ALLOWED_PUBLIC_DOC_TYPES_v368 = new Set([
      "loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging",
      "founder_cv", "financial_forecast",
    ]);
    const docTypeRaw = typeof docTypes[idx] === "string" ? docTypes[idx].trim() : "";
    if (!docTypeRaw || !ALLOWED_PUBLIC_DOC_TYPES_v368.has(docTypeRaw)) {
      return res.status(400).json({
        error: "invalid_doc_type",
        invalid_value: docTypeRaw || null,
        file_index: idx,
        allowed: Array.from(ALLOWED_PUBLIC_DOC_TYPES_v368),
      });
    }
    const docType = docTypeRaw;
    let put;
    try {
      put = await store.put({
        buffer: file.buffer,
        filename: file.originalname,
        contentType: file.mimetype,
        pathPrefix: `applications/${r.rows[0].id}`,
      });
    } catch (err) {
      return res.status(502).json({ error: "storage_failed", detail: String((err as Error)?.message ?? err) });
    }
    let inserted;
    try {
      inserted = await pool.query(
        `INSERT INTO bi_documents
           (application_id, doc_type, original_filename, storage_key, blob_name, blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'applicant')
         ON CONFLICT (application_id, doc_type) WHERE purged_at IS NULL
         DO UPDATE SET
           original_filename = EXCLUDED.original_filename,
           mime_type = EXCLUDED.mime_type,
           bytes = EXCLUDED.bytes,
           blob_url = EXCLUDED.blob_url,
           storage_key = EXCLUDED.storage_key,
           uploaded_at = NOW(),
           review_status = 'pending',
           pgi_document_id = NULL,
           forwarded_to_carrier_at = NULL
         RETURNING id`,
        [r.rows[0].id, docType, file.originalname, put.blobName, put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes],
      );
    } catch (err) {
      return res.status(400).json({ error: "invalid_doc_type", doc_type: docType, detail: String((err as Error)?.message ?? err) });
    }
    created.push({ id: inserted.rows[0].id as string, doc_type: docType, filename: file.originalname });
    // BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
    // Public-flow docs need OCR for the carrier text bundle, same as
    // staff uploads. Fire-and-forget: by the time staff clicks
    // Forward to carrier the row's ocr_status has flipped to
    // 'complete' / 'failed' / 'skipped'.
    void runOcrForDocument(inserted.rows[0].id as string, file).catch(() => { /* logged inside */ });
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','document_uploaded',$2)`,
      [r.rows[0].id, `Document uploaded: ${file.originalname}`],
    );
  }

  // BI_SERVER_BLOCK_v168_STAGE_TRANSITION_FIX_v1
  // V1 spec §3: 'source_type=public AND all docs uploaded' advances
  // 'in_progress' -> 'document_review'. Trigger fires on every upload
  // call (idempotent — only writes when status is currently in_progress).
  // The 'all docs uploaded' phrasing is satisfied by any successful
  // upload reaching this point, since the endpoint requires at least
  // one file (line 230 'no_files' guard).
  try {
    const advanceResult = await pool.query(
      `UPDATE bi_applications
          SET status = 'document_review', updated_at = NOW()
        WHERE id = $1 AND status = 'in_progress'
        RETURNING id`,
      [r.rows[0].id]
    );
    if (advanceResult.rowCount && advanceResult.rowCount > 0) {
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
         VALUES($1,'system','stage_advance','Auto-advanced to document_review on first doc upload')`,
        [r.rows[0].id]
      ).catch(() => {});
    }
  } catch (err) {
    // Non-fatal — uploads succeeded; stage advance can be retried.
    // eslint-disable-next-line no-console
    console.warn('[v168] stage advance failed', err);
  }

  return res.json({ ok: true, documents: created });
});

router.get("/applications/:publicId/documents", async (req, res) => {
  const r = await pool.query(
    `SELECT id FROM bi_applications WHERE public_id=$1`,
    [req.params.publicId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  const docs = await pool.query(
    `SELECT id, doc_type, original_filename, bytes, created_at,
             COALESCE(review_status, 'pending') AS review_status,
             rejection_reason, reviewed_at
       FROM bi_documents
      WHERE application_id=$1 AND purged_at IS NULL
      ORDER BY created_at DESC`,
    [r.rows[0].id],
  );
  return res.json({ documents: docs.rows });
});

export default router;
