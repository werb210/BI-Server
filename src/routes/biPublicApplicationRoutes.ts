import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../db";
import { pgiScore } from "../services/pgiAdapter";
import { generatePublicId } from "../util/publicId";
// BI_SERVER_BLOCK_v66_PUBLIC_DOCS_AND_MIGRATION_SAFE_v1
import multer from "multer";
import { getStorage } from "../lib/storage";

const router = Router();
const EBITDA_MIN = 50_000;
const LOAN_MAX = 1_000_000;

router.post("/applications/score", async (req, res) => {
  const b = req.body ?? {};
  const required = [
    "country", "naics_code", "formation_date", "loan_amount", "pgi_limit",
    "annual_revenue", "ebitda", "total_debt", "monthly_debt_service",
    "collateral_value", "enterprise_value",
  ];
  const missing = required.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  if (b.country !== "CA") return res.status(400).json({ error: "country_unsupported", supported: ["CA"] });
  if (Number(b.loan_amount) > LOAN_MAX) return res.status(400).json({ error: "loan_amount_exceeds_max", max: LOAN_MAX });
  if (Number(b.pgi_limit) > Number(b.loan_amount)) return res.status(400).json({ error: "pgi_limit_exceeds_loan" });
  if (Number(b.pgi_limit) > Number(b.loan_amount) * 0.80) return res.status(400).json({ error: "pgi_limit_exceeds_80pct" });
  if (Number(b.ebitda) < EBITDA_MIN) return res.status(400).json({ error: "ebitda_below_min", min: EBITDA_MIN });

  const id = crypto.randomUUID();
  const publicId = generatePublicId();

  // BI_SERVER_BLOCK_v164_SCORE_STAGE_FIX_v1
  // V1 spec ruling 15 + §3: score pass creates row in `created` stage.
  // The pipeline card only materializes once the user submits the full
  // 45-question form (which advances created -> in_progress).
  await pool.query(
    `INSERT INTO bi_applications
       (id, public_id, status, source,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        data,
        created_at, updated_at)
     VALUES ($1,$2,'created','public',
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, $14::jsonb, NOW(), NOW())`,
    [
      id, publicId,
      b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
      b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
      b.collateral_value, b.enterprise_value,
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

  const required = [
    "guarantor_name", "guarantor_email", "guarantor_dob", "guarantor_address",
    "guarantor_phone", "business_name", "business_address", "entity_type",
    "business_number", "lender_name", "loan_purpose", "loan_funding_date",
    "policy_start_date", "bankruptcy_history", "insolvency_history",
    "judgment_history", "personal_judgments", "business_judgments",
    "personally_guaranteeing", "consents",
  ];
  const missing = required.filter((k) => app[k] === null || app[k] === undefined || app[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  const c = app.consents ?? {};
  const consentKeys = [
    "electronic_signature", "info_accurate", "business_solvent",
    "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood",
  ];
  const unconsented = consentKeys.filter((k) => !c[k]);
  if (unconsented.length) return res.status(400).json({ error: "missing_consents", fields: unconsented });

  await pool.query(`UPDATE bi_applications SET status='document_review', updated_at=NOW() WHERE id=$1`, [app.id]);
  return res.json({ ok: true, status: "document_review" });
});


// BI_SERVER_BLOCK_v66_PUBLIC_DOCS_AND_MIGRATION_SAFE_v1 — public doc upload.
// Authenticates by public_id only (no JWT). Used by the BI-Website applicant
// flow after submit. Stores files to Azure Blob via the same storage abstraction
// as the staff-side upload route. 5MB per file per PGI carrier policy.
const publicDocUpload_v66 = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/applications/:publicId/documents", publicDocUpload_v66.array("files"), async (req, res) => {
  const r = await pool.query(
    `SELECT id, score_decision, status FROM bi_applications WHERE public_id=$1`,
    [req.params.publicId],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  if (r.rows[0].score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) return res.status(400).json({ error: "no_files" });

  const docTypesRaw = req.body?.doc_types;
  const docTypes = Array.isArray(docTypesRaw)
    ? docTypesRaw
    : typeof docTypesRaw === "string" ? [docTypesRaw] : [];

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
         RETURNING id`,
        [r.rows[0].id, docType, file.originalname, put.blobName, put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes],
      );
    } catch (err) {
      return res.status(400).json({ error: "invalid_doc_type", doc_type: docType, detail: String((err as Error)?.message ?? err) });
    }
    created.push({ id: inserted.rows[0].id as string, doc_type: docType, filename: file.originalname });
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','document_uploaded',$2)`,
      [r.rows[0].id, `Document uploaded: ${file.originalname}`],
    );
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
    `SELECT id, doc_type, original_filename, bytes, created_at
       FROM bi_documents
      WHERE application_id=$1 AND purged_at IS NULL
      ORDER BY created_at DESC`,
    [r.rows[0].id],
  );
  return res.json({ documents: docs.rows });
});

export default router;
