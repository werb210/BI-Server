// BI_SERVER_BLOCK_v213_LENDER_APPLICATIONS_POST_v1
// BI_SERVER_BLOCK_v223_LENDER_CARRIER_FORWARDING_v1
// BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1
// BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1
// BI_SERVER_BLOCK_v224_LENDER_NAME_ATTRIBUTION_v1
// BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3 — source_type='lender'
//   on the INSERT (was defaulting to 'public' before; portal mislabeled
//   lender apps). Also adds POST /api/v1/lender/applications/:code/documents
//   for the BI-Website lender form's post-create doc upload step
//   (previously 404'd because no server route handled that path).
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { notifyStaff } from "../services/staffNotifyService";
import { pool } from "../db";
import { pgiSubmit } from "../services/pgiAdapter";
import { logger } from "../platform/logger";
import { getStorage } from "../lib/storage";

const router = express.Router();

function genCode(): string { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let out = ""; for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }
function num(v: any): number | null { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : null; }
function bool(v: any): boolean { if (v === true || v === false) return v; if (typeof v === "string") return v.toLowerCase() === "yes" || v.toLowerCase() === "true"; return Boolean(v); }
function getLenderId(req: Request): string | null { const auth = req.header("authorization") || ""; const m = auth.match(/^Bearer\s+(.+)$/i); if (!m) return null; const secret = process.env.JWT_SECRET; if (!secret) return null; try { const payload = jwt.verify(m[1], secret) as any; if (payload?.kind !== "lender" || !payload?.id) return null; return String(payload.id); } catch { return null; } }
function getLenderUserId(req: Request): string | null { const auth = req.header("authorization") || ""; const m = auth.match(/^Bearer\s+(.+)$/i); if (!m) return null; const secret = process.env.JWT_SECRET; if (!secret) return null; try { const payload = jwt.verify(m[1], secret) as any; if (payload?.kind !== "lender" || !payload?.user_id) return null; return String(payload.user_id); } catch { return null; } }
// BI_SERVER_BLOCK_v244_DEMO_REFERRER_STORAGE_v1 — JWT carries is_demo
// for demo sessions (minted by /lender/demo/session). Reading the flag
// from the token rather than re-querying bi_lenders.is_demo is the
// authoritative source: the demo lender row's is_demo column had been
// silently flipped FALSE in at least one prod deploy (likely a manual
// SQL touch or a partial v226 rollback), which caused demo INSERTs to
// store is_demo=FALSE and disappear from the demo pipeline filter
// while showing up in the real pipeline as soon as the user hit
// "Exit demo". Trusting the JWT claim makes the demo flag depend
// solely on which session the user is in, not on row drift.
function getLenderIsDemo(req: Request): boolean { const auth = req.header("authorization") || ""; const m = auth.match(/^Bearer\s+(.+)$/i); if (!m) return false; const secret = process.env.JWT_SECRET; if (!secret) return false; try { const payload = jwt.verify(m[1], secret) as any; return payload?.is_demo === true; } catch { return false; } }

router.post("/api/v1/lender/applications", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.body || typeof req.body !== "object" || !req.body.guarantor || typeof req.body.guarantor !== "object") {
    return next();
  }
  const lenderId = getLenderId(req); if (!lenderId) return res.status(401).json({ error: "unauthorized", message: "Valid lender Bearer token required" });
  const lenderUserId = getLenderUserId(req);
  const b = req.body || {};
  // BI_SERVER_BLOCK_v350_LENDER_PURBECK_ALIGNMENT_v1
  // Required-field list aligned with v349 Purbeck schema. Risk booleans
  // dropped (hard-cut). Adds business.province, loan.q_ca_loan_type.
  // Declarations carried in b.declarations.* are validated at submit-to-pgi
  // time via v349 validatePgiSubmissionV2; this layer only checks intake-shape
  // completeness.
  const required: Array<[string, any]> = [
    ["company_name", b.company_name],
    ["guarantor.name", b.guarantor?.name],
    ["guarantor.phone", b.guarantor?.phone],
    ["business.naics", b.business?.naics],
    ["business.start_date", b.business?.start_date],
    ["business.province", b.business?.province],
    ["loan.amount", b.loan?.amount],
    ["loan.pgi_limit", b.loan?.pgi_limit],
    ["loan.q_ca_loan_type", b.loan?.q_ca_loan_type],
    ["financials.revenue_last_year", b.financials?.revenue_last_year ?? b.financials?.annual_revenue],
    ["financials.ebitda_last_year", b.financials?.ebitda_last_year ?? b.financials?.ebitda],
  ];
  const missing = required.filter(([_, v]) => v === undefined || v === null || v === "").map(([k]) => k);
  if (missing.length > 0) return res.status(400).json({ error: "validation", missing });

  // BI_SERVER_BLOCK_v350_LENDER_PURBECK_GUARDS_v1
  // Quebec block (defense in depth on top of UI dropdown).
  const province = String(b.business?.province || "").toUpperCase();
  if (province === "QC") {
    return res.status(400).json({ error: "quebec_blocked", message: "PGI does not currently write business in Quebec." });
  }

  // 1M caps (loan amount + PGI limit).
  const loanAmtN = Number(b.loan?.amount);
  if (Number.isFinite(loanAmtN) && loanAmtN > 1_000_000) {
    return res.status(400).json({ error: "loan_amount_over_cap", message: `Loan amount ${loanAmtN} exceeds the 1,000,000 maximum.` });
  }
  const pgiLimitN = Number(b.loan?.pgi_limit);
  if (Number.isFinite(pgiLimitN) && pgiLimitN > 1_000_000) {
    return res.status(400).json({ error: "pgi_limit_over_cap", message: `PGI limit ${pgiLimitN} exceeds the 1,000,000 maximum.` });
  }
  if (Number.isFinite(loanAmtN) && Number.isFinite(pgiLimitN) && pgiLimitN > loanAmtN) {
    return res.status(400).json({ error: "pgi_limit_over_loan", message: "PGI limit cannot exceed loan amount." });
  }

  // q_ca_loan_type allowlist.
  const ELIGIBLE_LOAN_TYPES = ["Commercial Mortgage", "Other Secured Loan"];
  const loanType = String(b.loan?.q_ca_loan_type || "");
  if (!ELIGIBLE_LOAN_TYPES.includes(loanType)) {
    return res.status(400).json({
      error: "loan_type_ineligible",
      message: `Loan type '${loanType}' is not eligible for Canadian PGI coverage. Eligible types are: ${ELIGIBLE_LOAN_TYPES.join(", ")}.`,
    });
  }
  const applicationCode = genCode();
  const country = (b.business?.country || "CA") as "CA" | "US"; const naics_code = String(b.business?.naics); const formation_date = String(b.business?.start_date); const loan_amount = num(b.loan?.amount) || 0; const pgi_limit = num(b.loan?.pgi_limit) || 0; const annual_revenue = num(b.financials?.revenue_last_year ?? b.financials?.annual_revenue) || 0; const ebitda = num(b.financials?.ebitda_last_year ?? b.financials?.ebitda) || 0; const total_debt = num(b.financials?.total_debt) || 0; const monthly_debt_service = num(b.financials?.monthly_payments ?? b.financials?.monthly_debt_service) || 0; const collateral_value = num(b.financials?.collateral_value) || 0; const enterprise_value = num(b.financials?.enterprise_value) || 0; const bankruptcy_history = bool(b.risk?.bankruptcy_history); const insolvency_history = bool(b.risk?.insolvency_history); const judgment_history = bool(b.risk?.judgment_history);
  const coreInputs = { country, naics: naics_code, naics_code, business_start_date: formation_date, formation_date, loan_amount, pgi_limit, use_of_proceeds: b.loan?.use_of_proceeds || "expansion", estimated_close_date: b.loan?.estimated_close_date ?? b.loan?.loan_funding_date, loan_funding_date: b.loan?.loan_funding_date, policy_start_date: b.loan?.policy_start_date, revenue: annual_revenue, annual_revenue, ebitda, total_debt, monthly_payments: monthly_debt_service, monthly_debt_service, collateral_value, enterprise_value, bankruptcy_history, insolvency_history, judgment_history };
  let lenderCompanyName: string | null = null;
  let lenderIsDemo = false;
  try {
    const lr = await pool.query(`SELECT company_name, is_demo FROM bi_lenders WHERE id = $1 LIMIT 1`, [lenderId]);
    lenderCompanyName = (lr.rows[0]?.company_name as string | undefined) || null;
    // BI_SERVER_BLOCK_v244_DEMO_REFERRER_STORAGE_v1 — JWT claim wins
    // when set; bi_lenders.is_demo is fallback for non-demo-session
    // paths (e.g. API-key auth for a lender flagged as demo at the
    // row level). OR semantics: a demo session can never store a
    // non-demo row, even if the bi_lenders row's flag is wrong.
    lenderIsDemo = (lr.rows[0]?.is_demo === true) || getLenderIsDemo(req);
  } catch {
    // Non-fatal: row still saved without lender_name. Fall back to JWT
    // claim alone if the bi_lenders SELECT threw (e.g. transient DB).
    lenderIsDemo = getLenderIsDemo(req);
  }
  // BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3 — added source_type='lender'.
  const result = await pool.query(`INSERT INTO bi_applications (entity_type, status, source, source_type, lender_id, created_by_lender_id, created_by_lender_user_id, application_code, company_name, guarantor_name, guarantor_phone, guarantor_email, lender_name, is_demo, core_inputs, consents, lender_notes, created_by_actor, created_at, updated_at) VALUES ('applicant', 'new_application', 'lender', 'lender', $1, $1, $12, $2, $3, $4, $5, $6, $10, $11, $7::jsonb, $8::jsonb, $9, 'lender', NOW(), NOW()) RETURNING id, application_code`, [lenderId, applicationCode, b.company_name, b.guarantor?.name, b.guarantor?.phone, b.guarantor?.email || null, JSON.stringify(coreInputs), JSON.stringify({ data_use: true, credit_pull: true, info_accurate: true, source: "lender_attestation" }), b.lender_notes || null, lenderCompanyName, lenderIsDemo, lenderUserId]);
  const row = result.rows[0]; const appId: string = row.id; const code: string = row.application_code;

  // BI_SERVER_BLOCK_v350_LENDER_DECLARATIONS_AND_COGUARANTORS_v1
  // Persist v349-shape declarations + co-guarantors so the submit-to-pgi
  // path (v349) finds them on the row at carrier-submit time.
  const declarations = (b.declarations && typeof b.declarations === "object") ? b.declarations : {};
  const coGuarantors = Array.isArray(b.co_guarantors) ? b.co_guarantors : [];
  const hasCoGuarantors = coGuarantors.length > 0;

  try {
    await pool.query(
      `UPDATE bi_applications
          SET declarations = $1::jsonb,
              has_co_guarantors = $2,
              q_business_province = $3,
              q_ca_loan_type = $4
        WHERE id = $5`,
      [JSON.stringify(declarations), hasCoGuarantors, province, loanType, appId],
    );
  } catch (e) {
    // Non-blocking: row exists, augmentation failed. Log and continue.
    logger.warn({ err: (e as Error).message }, "[v350] declarations/has_co_guarantors update failed");
  }

  for (const cg of coGuarantors) {
    if (!cg?.first_name || !cg?.last_name) continue;
    if (String(cg.province || "").toUpperCase() === "QC") continue; // server-side QC block on co-guarantor too
    try {
      await pool.query(
        `INSERT INTO bi_co_guarantors
          (application_id, first_name, last_name, email, date_of_birth, phone, address, city, province, postal_code, relationship)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          appId,
          String(cg.first_name), String(cg.last_name),
          String(cg.email || ""), String(cg.date_of_birth || ""),
          String(cg.phone || ""), String(cg.address || ""),
          String(cg.city || ""), String(cg.province || ""),
          String(cg.postal_code || ""), String(cg.relationship || "Guarantor"),
        ],
      );
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "[v350] co_guarantor insert failed");
    }
  }
  let pgi_application_id: string | null = null;
  let pgi_status: string | null = null;
  let pgi_error: string | null = null;
  const carrierRequestBody = {
    guarantor_name: b.guarantor?.name,
    guarantor_email: b.guarantor?.email || `${(b.guarantor?.phone || "unknown").replace(/[^0-9]/g, "")}@no-email.boreal`,
    business_name: b.company_name,
    lender_name: lenderCompanyName ?? undefined,
    form_data: { country, naics_code, formation_date, loan_amount, pgi_limit, annual_revenue, ebitda, total_debt, monthly_debt_service, collateral_value, enterprise_value, bankruptcy_history, insolvency_history, judgment_history },
  };
  try {
    let submit;
    if (lenderIsDemo) {
      submit = { application_id: `STUB_APP_DEMO_${Date.now()}`, status: "received", message: "Demo submission — carrier call skipped." } as any;
    } else {
      submit = await pgiSubmit(carrierRequestBody);
    }
    pgi_application_id = submit.application_id;
    pgi_status = submit.status || "received";
    // BI_SERVER_BLOCK_v243_LENDER_STAGE_ROUTING_v1 — was status='submitted';
    // now sent_to_pgi to land in the v47 8-stage operator-spec column.
    // Migration v243 also remaps existing legacy 'submitted' lender rows.
    await pool.query(
      `UPDATE bi_applications
          SET pgi_application_id=$1,
              status='sent_to_pgi',
              carrier_received_at=NOW(),
              carrier_last_event='application.submitted',
              carrier_last_event_at=NOW(),
              carrier_submission_request=$2::jsonb,
              carrier_submission_response=$3::jsonb,
              updated_at=NOW()
        WHERE id=$4`,
      [pgi_application_id, JSON.stringify(carrierRequestBody), JSON.stringify(submit), appId],
    );
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES($1, 'system', 'pgi.submit_succeeded', $2, $3::jsonb)`,
      [appId, `Submitted to carrier — PGI id ${pgi_application_id}`, JSON.stringify({ request: carrierRequestBody, response: submit })],
    ).catch(() => {});
  } catch (e: any) {
    pgi_error = String(e?.message ?? e);
    logger.error({ application_id: appId, lender_id: lenderId, err: pgi_error }, "lender_app_pgi_submit_failed");
    await pool.query(
      `UPDATE bi_applications
          SET carrier_submission_request=$1::jsonb,
              carrier_submission_error=$2,
              carrier_last_event='application.submit_failed',
              carrier_last_event_at=NOW(),
              updated_at=NOW()
        WHERE id=$3`,
      [JSON.stringify(carrierRequestBody), pgi_error, appId],
    ).catch(() => {});
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES($1, 'system', 'pgi.submit_failed', $2, $3::jsonb)`,
      [appId, `Carrier submission failed: ${pgi_error}`, JSON.stringify({ request: carrierRequestBody, error: pgi_error })],
    ).catch(() => {});
  }
  void notifyStaff("new_application", `New BI lender app: ${(b as any).business_name || (b as any).company_name || "Untitled"}`).catch(() => {});
  return res.status(201).json({ ok: true, id: appId, application_code: code, pgi_application_id, pgi_status, pgi_error });
});

const lenderDocUpload_v262 = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
router.post(
  "/api/v1/lender/applications/:code/documents",
  lenderDocUpload_v262.array("files"),
  async (req: Request, res: Response) => {
    const lenderId = getLenderId(req);
    if (!lenderId) return res.status(401).json({ error: "unauthorized" }); // BI_SERVER_BLOCK_v262
    const code = String(req.params.code || "").trim();
    if (!code) return res.status(400).json({ error: "missing_code" }); // BI_SERVER_BLOCK_v262

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
    const lookup = await pool.query<{ id: string; lender_id: string | null; created_by_lender_id: string | null }>(
      isUuid
        ? `SELECT id, lender_id, created_by_lender_id FROM bi_applications WHERE id = $1 LIMIT 1`
        : `SELECT id, lender_id, created_by_lender_id FROM bi_applications WHERE application_code = $1 LIMIT 1`,
      [code]
    );
    const app = lookup.rows[0];
    if (!app) return res.status(404).json({ error: "not_found" }); // BI_SERVER_BLOCK_v262
    if (app.lender_id !== lenderId && app.created_by_lender_id !== lenderId) {
      return res.status(403).json({ error: "wrong_lender" }); // BI_SERVER_BLOCK_v262
    }

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "no_files" }); // BI_SERVER_BLOCK_v262

    const docTypesRaw = req.body?.doc_types;
    const docTypes = Array.isArray(docTypesRaw) ? docTypesRaw : typeof docTypesRaw === "string" ? [docTypesRaw] : [];

    const store = getStorage();
    const created: Array<{ id: string; doc_type: string; filename: string }> = [];

    for (const [idx, file] of files.entries()) {
      const docType = typeof docTypes[idx] === "string" && docTypes[idx].trim() ? docTypes[idx].trim() : "other";
      let put;
      try {
        put = await store.put({ buffer: file.buffer, filename: file.originalname, contentType: file.mimetype, pathPrefix: `applications/${app.id}` }); // BI_SERVER_BLOCK_v262
      } catch (err) {
        return res.status(502).json({ error: "storage_failed", detail: String((err as Error)?.message ?? err) }); // BI_SERVER_BLOCK_v262
      }
      let inserted;
      try {
        inserted = await pool.query<{ id: string }>(
          `INSERT INTO bi_documents
             (application_id, doc_type, original_filename, storage_key, blob_name, blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor, doc_slot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'lender',$10)
           RETURNING id`,
          [app.id, docType, file.originalname, put.blobName, put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes, docType]
        );
      } catch (err) {
        return res.status(400).json({ error: "invalid_doc_type", doc_type: docType, detail: String((err as Error)?.message ?? err) });
      }
      created.push({ id: inserted.rows[0].id, doc_type: docType, filename: file.originalname });
      await pool.query(`INSERT INTO bi_activity(application_id, actor_type, event_type, summary) VALUES($1,'lender','document_uploaded',$2)`, [app.id, `Document uploaded: ${file.originalname}`]).catch(() => {});
    }
    return res.json({ ok: true, documents: created });
  }
);

export default router;
