import { Router } from "express";
import { pool } from "../db";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

const TERMINAL_STAGES = new Set(["declined", "policy_issued", "bound", "claim"]);

async function enqueuePurgeIfTerminal(applicationId: string, stage: string) {
  if (!TERMINAL_STAGES.has(stage)) return;
  await pool.query(
    `INSERT INTO bi_purge_queue(application_id, eligible_at)
     VALUES($1, NOW())
     ON CONFLICT (application_id) DO NOTHING`,
    [applicationId]
  );
}


// BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2
// The portal's BIPipeline page (BF_PORTAL_BLOCK_v193_BI_SILO_ALIGN_v1)
// expects 15+ fields per row plus hide_demo and lender_id filters,
// and wraps results in {applications: [...]}. The previous handler
// returned a 6-field bare array, so Pipeline cards rendered with no
// business name, no guarantor, no loan amount, no carrier chip, and
// the demo / lender filters were ignored.
//
// Adds an effective_stage column on every row (status passed through
// as stage when set, falling back to the raw stage enum) so the
// portal's stage badges + filtering work for public apps whose stage
// column is never written by the public flow.
router.get("/applications", async (req, res) => {
  const hideDemo = String(req.query.hide_demo ?? "").toLowerCase() === "true";
  // BI_SERVER_BLOCK_v268_CLEANUP_v1 — F-1: validate UUID format before
  // letting it reach the $2::uuid cast, which throws 22P02 and 500s
  // the whole listing if a malformed value comes in.
  const UUID_RE_v268 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawLenderId = typeof req.query.lender_id === "string" ? req.query.lender_id.trim() : "";
  if (rawLenderId && !UUID_RE_v268.test(rawLenderId)) {
    return res.status(400).json({ error: "lender_id_not_uuid" });
  }
  const lenderId = rawLenderId || null;

  const result = await pool.query(
    `SELECT a.id,
            a.public_id,
            a.application_code,
            -- BI_SERVER_BLOCK_v265_PIPELINE_CASE_ALIGN_BI_STAGES_v1
            -- BI_SERVER_BLOCK_v243_LENDER_STAGE_ROUTING_v1
            -- Every value here must exist in BI_STAGES (BF-portal
            -- biStages.ts). After v47's 8-stage realignment the visible
            -- columns are: new_application, documents_pending,
            -- under_review, docs_rejected, sent_to_pgi, quoted, bound,
            -- declined. The legacy 'submitted' status (used by
            -- biLenderApplicationCreate pre-v243) is now remapped to
            -- 'sent_to_pgi' so pre-v243 lender rows surface in the new
            -- "Sent to PGI" column. 'ready_for_submission' likewise
            -- routes to sent_to_pgi as it represents the same
            -- "forwarded to carrier" state.
            COALESCE(
              CASE
                WHEN a.status = 'created'              THEN 'new_application'
                WHEN a.status = 'new_application'      THEN 'new_application'
                WHEN a.status = 'in_progress'          THEN 'documents_pending'
                WHEN a.status = 'document_review'      THEN 'under_review'
                WHEN a.status = 'under_review'         THEN 'under_review'
                WHEN a.status = 'information_required' THEN 'under_review'
                WHEN a.status = 'docs_rejected'        THEN 'docs_rejected'
                WHEN a.status = 'ready_for_submission' THEN 'sent_to_pgi'
                WHEN a.status = 'submitted'            THEN 'sent_to_pgi'
                WHEN a.status = 'sent_to_pgi'          THEN 'sent_to_pgi'
                WHEN a.status = 'approved'             THEN 'quoted'
                WHEN a.status = 'declined'             THEN 'declined'
                WHEN a.status = 'policy_issued'        THEN 'bound'
                ELSE NULL
              END,
              a.stage::text
            ) AS stage,
            a.source,
            a.source_type,
            a.bankruptcy_flag,
            a.premium_calc,
            a.created_by_lender_id,
            a.is_demo,
            a.business_name,
            COALESCE(a.company_name, co.legal_name, a.business_name) AS company_name,
            a.guarantor_name,
            a.lender_name,
            a.loan_amount,
            a.pgi_limit,
            a.carrier_received_at,
            a.carrier_last_event,
            a.carrier_last_event_at,
            a.pgi_application_id,
            a.created_at,
            a.updated_at,
            c.full_name AS primary_contact_name
     FROM bi_applications a
     LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
     LEFT JOIN bi_companies co ON co.id = a.company_id
     WHERE ($1::boolean IS FALSE OR COALESCE(a.is_demo, FALSE) = FALSE)
       AND ($2::uuid IS NULL OR a.created_by_lender_id = $2::uuid)
     ORDER BY a.created_at DESC`,
    [hideDemo, lenderId]
  );

  return ok(res, { applications: result.rows });
});

router.get("/pipeline", async (req, res) => {
  const stage = String(req.query.stage || "").trim();
  if (!stage) {
    return badRequest(res, "stage is required");
  }

  const result = await pool.query(
    `SELECT id, stage, created_at, updated_at, applicant_phone_e164, premium_calc
     FROM bi_applications
     WHERE stage = $1
     ORDER BY updated_at DESC`,
    [stage]
  );

  return ok(res, result.rows);
});

// BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2
// The portal's biPipelineAdapter.move POSTs PATCH to
// /api/v1/bi/applications/:id/stage. The pre-existing handler lived
// at /pipeline/:id/stage which didn't match — the Kanban drag-and-drop
// hit 404 silently. Expose both paths via a shared handler.
async function setStageHandler(req: any, res: any) {
  const id = req.params.id;
  const { stage } = req.body as { stage?: string };
  const actor = (req.user as { staffUserId?: string } | undefined)?.staffUserId || null;

  if (!stage) {
    return badRequest(res, "stage is required");
  }

  await pool.query(`UPDATE bi_applications SET stage=$2, updated_at=NOW() WHERE id=$1`, [id, stage]);
  await enqueuePurgeIfTerminal(id, stage);

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES($1, 'staff', $2, 'stage_change', $3, $4::jsonb)`,
    [id, actor, `Stage changed to ${stage}`, JSON.stringify({ stage })]
  );

  return ok(res, { success: true });
}
router.patch("/pipeline/:id/stage", setStageHandler);
router.patch("/applications/:id/stage", setStageHandler);

// BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2
// GET /applications/:id must return all_docs_accepted (boolean) and an
// effective stage so the portal's "Forward to carrier" button works.
//
// (1) all_docs_accepted: TRUE iff there's ≥1 bi_documents row AND
//     every (non-purged) row has review_status='accepted'. Without
//     this the portal's gate is undefined → falsy → button hidden.
//
// (2) effective_stage: the public flow only writes the `status` TEXT
//     column, never the `stage` ENUM. The portal reads `app.stage`.
//     We pass through the status value when present so portal checks
//     like `app.stage === 'document_review'` match reality.
//
// (3) company_name COALESCE: the original `co.legal_name AS company_name`
//     collided with the new a.company_name column added by the v260
//     migration. node-pg drops the earlier value, leaving null for
//     lender apps that don't have a bi_companies row. COALESCE all
//     three sources so the field is populated regardless of path.
router.get("/applications/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.*,
            c.full_name AS primary_contact_name,
            COALESCE(a.company_name, co.legal_name, a.business_name) AS company_name,
            COALESCE(pa.data->>'status', a.stage::text) AS pgi_status,
            -- BI_SERVER_BLOCK_v276_REJECTED_DOCS_DONT_BLOCK_GATE_v1
            -- Gate flips TRUE iff there's ≥1 accepted doc AND no
            -- doc is still pending review. 'rejected' rows are
            -- neither — they stay visible to staff but a replacement
            -- + accept on the new doc lets the gate flip.
            (EXISTS (
               SELECT 1 FROM bi_documents
               WHERE application_id = a.id
                 AND purged_at IS NULL
                 AND review_status = 'accepted'
             )
             AND NOT EXISTS (
               SELECT 1 FROM bi_documents
               WHERE application_id = a.id
                 AND purged_at IS NULL
                 AND COALESCE(review_status, 'pending') NOT IN ('accepted', 'rejected')
             )) AS all_docs_accepted,
            -- BI_SERVER_BLOCK_v265_PIPELINE_CASE_ALIGN_BI_STAGES_v1 (detail)
            -- BI_SERVER_BLOCK_v243_LENDER_STAGE_ROUTING_v1
            COALESCE(
              CASE
                WHEN a.status = 'created'              THEN 'new_application'
                WHEN a.status = 'new_application'      THEN 'new_application'
                WHEN a.status = 'in_progress'          THEN 'documents_pending'
                WHEN a.status = 'document_review'      THEN 'under_review'
                WHEN a.status = 'under_review'         THEN 'under_review'
                WHEN a.status = 'information_required' THEN 'under_review'
                WHEN a.status = 'docs_rejected'        THEN 'docs_rejected'
                WHEN a.status = 'ready_for_submission' THEN 'sent_to_pgi'
                WHEN a.status = 'submitted'            THEN 'sent_to_pgi'
                WHEN a.status = 'sent_to_pgi'          THEN 'sent_to_pgi'
                WHEN a.status = 'approved'             THEN 'quoted'
                WHEN a.status = 'declined'             THEN 'declined'
                WHEN a.status = 'policy_issued'        THEN 'bound'
                ELSE NULL
              END,
              a.stage::text
            ) AS effective_stage
     FROM bi_applications a
     LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
     LEFT JOIN bi_companies co ON co.id = a.company_id
     LEFT JOIN pgi_applications pa ON pa.id = a.id OR pa.data->>'externalId' = a.pgi_external_id
     WHERE a.id=$1`,
    [id]
  );

  if (result.rows.length === 0) {
    return badRequest(res, "Not found");
  }

  const row = result.rows[0];
  const payload = {
    ...row,
    pgiStatus: row.pgi_status,
    // Override `stage` with the derived value so portal-side gates
    // (BIApplicationDetail / ApplicationTab.canSubmit) compare against
    // the right value. Raw stage column is still in row but gets
    // shadowed by this spread+override.
    stage: row.effective_stage,
  };
  delete payload.pgi_status;
  delete payload.effective_stage;
  return ok(res, payload);
});

// BI_SERVER_BLOCK_v260_CARRIER_PATH_E2E_FIX_v1
// The portal's DocumentsTab reads:
//   const r = await api<{documents: Doc[]}>(...); setDocs(r.documents);
// and renders fields (status, doc_type, doc_slot, period_end, ocr_status)
// that the previous handler never returned. Two fixes:
//   (1) Enrich the SELECT with review_status (aliased to 'status' so
//       the portal type lines up), doc_type, doc_slot, period_end,
//       ocr_status.
//   (2) Wrap the response in {documents: [...]} so r.documents is
//       populated. The old shape was a bare array, which made
//       r.documents undefined and setDocs(undefined) eventually
//       crashed the tab on render.
router.get("/applications/:id/documents", async (req, res) => {
  const { id } = req.params;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const result = await pool.query(
    `SELECT id,
            original_filename,
            created_at,
            doc_type::text   AS doc_type,
            doc_slot,
            period_end,
            COALESCE(review_status, 'pending') AS status,
            ocr_status::text AS ocr_status
     FROM bi_documents
     WHERE application_id=$1
       AND purged_at IS NULL
     ORDER BY created_at DESC`,
    [id]
  );

  const documents = result.rows.map((row) => ({
    id: row.id,
    file_name: row.original_filename,
    url: `${baseUrl}/api/v1/bi/documents/${row.id}`,
    uploaded_at: row.created_at,
    doc_type: row.doc_type,
    doc_slot: row.doc_slot,
    period_end: row.period_end,
    status: row.status,
    ocr_status: row.ocr_status,
  }));

  return ok(res, { documents });
});

router.post("/application/:id/submit-pgi", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await submitApplicationToPGI(id);
    return ok(res, { success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit to PGI";
    return badRequest(res, message);
  }
});

router.get("/applications/:id/activity", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT * FROM bi_activity WHERE application_id=$1 ORDER BY created_at DESC`, [id]);
  return ok(res, result.rows);
});

router.get("/applications/:id/requirements", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT id, application_id, label, status, created_at, updated_at
     FROM bi_requirements
     WHERE application_id=$1
     ORDER BY created_at DESC`,
    [id]
  );

  return ok(res, result.rows);
});

router.patch("/applications/:id/requirements/:reqId", async (req, res) => {
  const { id, reqId } = req.params;
  const { status } = req.body as { status?: "received" | "waived" | "rejected" | "pending" };

  if (!status) {
    return badRequest(res, "status is required");
  }

  const updated = await pool.query(
    `UPDATE bi_requirements
     SET status=$3, updated_at=NOW()
     WHERE id=$2 AND application_id=$1
     RETURNING *`,
    [id, reqId, status]
  );

  await pool.query(
    `INSERT INTO bi_requirements_history(requirement_id, application_id, old_status, new_status)
     VALUES($1, $2, NULL, $3)`,
    [reqId, id, status]
  );

  return ok(res, updated.rows[0] ?? null);
});

router.get("/application/by-phone", async (req, res) => {
  const { phone } = req.query;
  const result = await pool.query(
    `SELECT * FROM bi_applications
     WHERE applicant_phone_e164=$1
       AND stage IN ('new_application','documents_pending','under_review')
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );

  return ok(res, result.rows[0] ?? null);
});

export default router;


// BI_PGI_ALIGNMENT_v56 — PGI-aligned submission routes.
import { validatePgiSubmission } from "../lib/validation/pgiFields";
import { mirrorToContact } from "../services/crmMirrorService";
import { notifyStaff } from "../services/staffNotifyService";

async function persistApplication(submission: ReturnType<typeof validatePgiSubmission>, sourceType: "public" | "lender", lenderId: string | null, applicantPhoneE164: string | null = null): Promise<string> {
  if (!submission.ok) throw new Error("invalid submission");
  const { value } = submission;
  const docsRequired = sourceType === "public";
  const initialStage = sourceType === "lender" ? "under_review" : "new_application";
  const r = await (await import("../db")).pool.query<{ id: string }>(`INSERT INTO bi_applications (created_by_actor, created_by_lender_id, source_type, docs_review_required, applicant_phone_e164, stage, data, guarantor_name, guarantor_email, lender_name) VALUES ($1, $2, $3, $4, $5, $6::bi_pipeline_stage, $7::jsonb, $8, $9, $10) RETURNING id`, [sourceType === "lender" ? "lender" : "applicant", lenderId, sourceType, docsRequired, (/* BI_SERVER_BLOCK_v181_DROP_PLACEHOLDER_PHONE_v1 */ applicantPhoneE164), initialStage, JSON.stringify({ ...value.form_data, business_name: value.business_name, lender_name: value.lender_name ?? null }), value.guarantor_name, value.guarantor_email, value.lender_name ?? null]);
  return r.rows[0]!.id;
}
router.post("/applications/lender", async (req, res) => { const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId; if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); const lenderRow = (await (await import("../db")).pool.query<{ id: string }>(`SELECT id FROM bi_lenders WHERE user_id = $1 AND is_active = TRUE LIMIT 1`, [userId])).rows[0]; if (!lenderRow) return res.status(403).json({ ok: false, error: "NOT_A_LENDER" }); const v = validatePgiSubmission(req.body); if (!v.ok) return res.status(400).json({ ok: false, error: "PGI_VALIDATION_FAILED", issues: v.issues }); try { const id = await persistApplication(v, "lender", lenderRow.id, null); await mirrorToContact({ source: "applicant", full_name: v.value.guarantor_name, email: v.value.guarantor_email, company_name: v.value.business_name, lifecycle_stage: "applicant", extra_tags: [`application:${id}`, `lender:${lenderRow.id}`] }); const result = await submitApplicationToPGI(id); return res.status(201).json({ ok: true, application_id: id, source: "lender", pgi: result }); } catch (err) { return res.status(500).json({ ok: false, error: "SUBMIT_FAILED", message: err instanceof Error ? err.message : "unknown" }); }});
router.post("/applications/:id/submit-to-carrier", async (req, res) => {
  // BI_SERVER_BLOCK_v160_SUBMIT_TO_CARRIER_HARDENING_v1
  // V1 spec §7 (Send to Carrier button) + §8 (acceptance tests 2-9).
  // Required controls in order:
  //   (1) admin role only
  //   (2) source_type='public' (lender submissions auto-forward)
  //   (3) status='document_review'
  //   (4) submission_locked=false (idempotency)
  //   (5) all docs accepted
  //   (6) LOCK application before PGI call
  //   (7) write payload_snapshot to bi_submission_logs
  //   (8) call PGI; on success update log with response, on failure
  //       release lock + return to document_review + log error_message
  const id = req.params.id;
  const pool = (await import("../db")).pool;

  // (1) admin role gate
  const role = String((req.user as { role?: string } | undefined)?.role ?? "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ ok: false, error: "ADMIN_ONLY" });
  }
  const submittedBy = (req.user as { staffUserId?: string } | undefined)?.staffUserId ?? null;

  // Load application with all the fields needed for the gates.
  const r = await pool.query<{
    source_type: string;
    stage: string;
    status: string | null;
    submission_locked: boolean;
  }>(
    `SELECT source_type, stage, status, submission_locked
       FROM bi_applications WHERE id = $1 LIMIT 1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  // (2) source_type
  if (row.source_type !== "public") {
    return res.status(400).json({
      ok: false,
      error: "WRONG_SOURCE",
      message: "Lender submissions auto-forward; only public apps need staff submit.",
    });
  }

  // (3) status='document_review'
  // The V1 spec uses 'status' for the 10-stage value; some installs map it
  // through 'stage' instead. Accept either, but require the value to be
  // 'document_review' before this submit is valid.
  const currentStatus = String(row.status ?? row.stage ?? "").toLowerCase();
  if (currentStatus !== "document_review") {
    return res.status(400).json({
      ok: false,
      error: "WRONG_STAGE",
      message: `submit requires status='document_review' (current: ${currentStatus || "unknown"})`,
    });
  }

  // (4) idempotency: submission_locked must be false
  if (row.submission_locked === true) {
    return res.status(409).json({ ok: false, error: "ALREADY_LOCKED" });
  }

  // (5) all docs accepted
  const docs = await pool.query<{ pending: string; accepted: string }>(
    `SELECT
        COUNT(*) FILTER (WHERE COALESCE(review_status, 'pending') NOT IN ('accepted', 'rejected'))::text AS pending,
        COUNT(*) FILTER (WHERE review_status = 'accepted')::text AS accepted
       FROM bi_documents
      WHERE application_id = $1
        AND purged_at IS NULL`,
    [id]
  );
  if (Number(docs.rows[0]?.accepted ?? 0) === 0 || Number(docs.rows[0]?.pending ?? 0) > 0) {
    return res.status(400).json({ ok: false, error: "DOCS_NOT_ALL_ACCEPTED" });
  }

  // (6) LOCK application
  const lockResult = await pool.query(
    `UPDATE bi_applications
        SET submission_locked = TRUE, updated_at = NOW()
      WHERE id = $1 AND submission_locked = FALSE
      RETURNING id`,
    [id]
  );
  if (lockResult.rowCount === 0) {
    // Race lost — another submitter beat us.
    return res.status(409).json({ ok: false, error: "ALREADY_LOCKED" });
  }

  // (7) payload snapshot to bi_submission_logs (best-effort; do not fail
  // the submit on log insert error, but capture for triage).
  const snapshot = await pool
    .query<{ data: unknown }>(
      `SELECT row_to_json(a) AS data FROM bi_applications a WHERE id = $1 LIMIT 1`,
      [id]
    )
    .then((rs) => rs.rows[0]?.data ?? {})
    .catch(() => ({}));

  const logResult = await pool
    .query<{ id: string }>(
      `INSERT INTO bi_submission_logs (application_id, payload_snapshot, submitted_by)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id`,
      [id, JSON.stringify(snapshot), submittedBy]
    )
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[bi_submission_logs] insert failed", err);
      return { rows: [{ id: null as unknown as string }] };
    });
  const logId = logResult.rows[0]?.id ?? null;

  // (8) call PGI; on failure release lock and return to document_review.
  try {
    const result = await submitApplicationToPGI(id);
    // Update log with response.
    if (logId) {
      await pool
        .query(
          `UPDATE bi_submission_logs
              SET response_status = 200,
                  response_body = $2::jsonb
            WHERE id = $1`,
          [logId, JSON.stringify(result)]
        )
        .catch(() => {});
    }
    return res.status(200).json({ ok: true, pgi: result });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Release lock and revert to document_review.
    await pool
      .query(
        `UPDATE bi_applications
            SET submission_locked = FALSE,
                stage = 'document_review',
                updated_at = NOW()
          WHERE id = $1`,
        [id]
      )
      .catch(() => {});
    if (logId) {
      await pool
        .query(
          `UPDATE bi_submission_logs
              SET response_status = 500,
                  error_message = $2
            WHERE id = $1`,
          [logId, errorMessage]
        )
        .catch(() => {});
    }
    return res.status(500).json({
      ok: false,
      error: "SUBMIT_FAILED",
      message: errorMessage,
    });
  }
});

// BI_AUDIT_FIX_v58 — /applications/public moved to biPublicApplicationRoutes.ts
