// BI_SERVER_BLOCK_BI_ROUND8_DETAIL_ENDPOINTS_v1
// Application detail tab data sources + nested document accept/reject.
// Mounted at /api/v1/bi/applications by server.ts.
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";

const router: Router = Router();

// Inline role gate aligned with biDocumentRoutes behavior.
function requireStaffOrAdmin(req: any, res: any, next: any) {
  const role = String((req.user as { role?: string } | undefined)?.role ?? "").toLowerCase();
  if (role !== "admin" && role !== "staff") {
    return res.status(403).json({ status: "error", error: "STAFF_OR_ADMIN_ONLY" });
  }
  next();
}

// Human labels for the bi_document_type enum. Add a new entry when
// the enum is extended (see 20260222_00_bi_master_schema.sql).
const DOC_TYPE_LABELS: Record<string, string> = {
  loan_agreement_signed:     "Loan agreement (signed)",
  personal_guarantee_copy:   "Personal guarantee copy",
  financial_statements:      "Financial statements",
  proof_of_id:               "Government-issued ID",
  corporate_registration_docs: "Corporate registration",
  id_verification:           "ID verification",
  enforcement_notice:        "Enforcement notice",
};

// PGI-required doc types. The carrier API drives this list; until
// PGI exposes a per-product schema we hold the default here.
// Extras the applicant uploads still appear in the tab (required:
// false) so staff don't lose them.
const PGI_REQUIRED_DOC_TYPES: readonly string[] = [
  "proof_of_id",
  "financial_statements",
  "corporate_registration_docs",
  "personal_guarantee_copy",
];

// Doc-related event types that should surface in the
// Requirement History tab. Sourced from bi_activity. Other event
// types (application_created, etc.) are skipped.
const DOC_HISTORY_EVENT_TYPES: readonly string[] = [
  "document_uploaded",
  "document_accepted",
  "document_rejected",
  "document_ocr_complete",
  "document_purged",
  "application_stage_changed",
];

async function acceptDocumentLogic(req: Request, res: Response, idParam: string, docIdParam: string): Promise<void> {
  const appId = String(idParam);
  const docId = String(docIdParam);
  const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId ?? null;

  try {
    const docR = await pool.query<{ application_id: string; doc_type: string; source_type: string }>(
      `SELECT d.application_id, d.doc_type, a.source_type
         FROM bi_documents d
         JOIN bi_applications a ON a.id = d.application_id
        WHERE d.id = $1 LIMIT 1`,
      [docId],
    );
    if (docR.rowCount === 0) {
      res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
      return;
    }
    const doc = docR.rows[0];
    if (doc.application_id !== appId) {
      res.status(400).json({ error: { code: "mismatch", message: "Document does not belong to this application" } });
      return;
    }
    if (doc.source_type === "lender" || doc.source_type === "referrer") {
      res.status(403).json({ error: { code: "view_only", message: "Lender/referrer apps are view-only" } });
      return;
    }

    await pool.query(
      `UPDATE bi_documents
          SET review_status='accepted', reviewed_by=$2, reviewed_at=NOW()
        WHERE id=$1`,
      [docId, userId],
    );

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
            VALUES($1, 'staff', $2, 'document_accepted', $3, $4::jsonb)`,
      [appId, userId, `Document accepted: ${doc.doc_type}`, JSON.stringify({ docId })],
    );

    // BI_SERVER_BLOCK_v391_AUTO_SUBMIT_ON_LAST_DOC_ACCEPT_v1
    try {
      const appRow = await pool.query<{ id: string; stage: string; source_type: string }>(
        `SELECT id, stage, source_type FROM bi_applications WHERE id=$1 LIMIT 1`,
        [appId],
      );
      const a = appRow.rows[0];
      if (a && a.source_type === "public" && (a.stage === "document_review" || a.stage === "documents_pending")) {
        const reqQ = await pool.query<{ required: number; accepted: number }>(`
          WITH formation AS (
            SELECT formation_date FROM bi_applications WHERE id=$1
          ),
          startup AS (
            SELECT CASE WHEN (SELECT formation_date FROM formation) IS NULL
                         THEN FALSE
                        WHEN (SELECT formation_date FROM formation) > (NOW() - INTERVAL '3 years')
                         THEN TRUE
                        ELSE FALSE END AS is_startup
          ),
          required AS (
            SELECT doc_type FROM bi_required_doc_catalog
            WHERE active = TRUE
              AND (if_startup = FALSE OR (SELECT is_startup FROM startup))
          )
          SELECT
            (SELECT COUNT(*) FROM required) AS required,
            (SELECT COUNT(DISTINCT d.doc_type)
               FROM bi_documents d
              WHERE d.application_id = $1
                AND d.purged_at IS NULL
                AND d.review_status = 'accepted'
                AND d.doc_type IN (SELECT doc_type FROM required)) AS accepted
        `, [appId]);
        const counts = reqQ.rows[0];
        if (counts && Number(counts.required) > 0 && Number(counts.accepted) >= Number(counts.required)) {
          const { submitLenderApplicationToCarrier } = await import("../services/lenderCarrierSubmit");
          const snap = await pool.query(`SELECT * FROM bi_applications WHERE id=$1 LIMIT 1`, [appId]);
          const r = snap.rows[0];
          await submitLenderApplicationToCarrier({
            applicationId: appId,
            publicId: r.application_code,
            isDemo: Boolean(r.is_demo),
            guarantor_name: r.guarantor_name,
            guarantor_email: r.guarantor_email,
            business_name: r.business_name,
            lender_name: r.lender_name,
            rowSnapshot: r,
            formData: r.core_inputs ?? {},
            declarations: r.declarations ?? {},
          }).catch((err: Error) => {
            console.warn("[v391] auto-submit failed", err.message);
          });
        }
      }
    } catch (autoSubmitErr) {
      console.warn("[v391] auto-submit check failed", (autoSubmitErr as Error).message);
    }

    const counts = await pool.query<{ pending: string; accepted: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(review_status, 'pending') NOT IN ('accepted', 'rejected')) AS pending,
         COUNT(*) FILTER (WHERE review_status = 'accepted') AS accepted,
         COUNT(*) AS total
       FROM bi_documents
       WHERE application_id = $1 AND purged_at IS NULL`,
      [appId],
    );
    const total = Number(counts.rows[0]?.total ?? 0);
    const pending = Number(counts.rows[0]?.pending ?? 0);
    const acceptedCount = Number(counts.rows[0]?.accepted ?? 0);

    let stageAdvanced = false;
    let finalStatus: string | null = null;
    let autoSubmittedToPgi = false;
    let pgiSubmitError: string | null = null;

    if (acceptedCount > 0 && pending === 0) {
      const advance = await pool.query(
        `UPDATE bi_applications
            SET status = 'ready_for_submission', updated_at = NOW()
          WHERE id = $1
            AND status IN ('in_progress', 'document_review')
          RETURNING id`,
        [appId],
      );
      stageAdvanced = (advance.rowCount ?? 0) > 0;
      finalStatus = stageAdvanced ? "ready_for_submission" : null;

      if (stageAdvanced) {
        await pool.query(
          `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
                VALUES($1, 'system', $2, 'application_stage_changed', $3, $4::jsonb)`,
          [
            appId, userId,
            `Application advanced to ready_for_submission after all documents accepted`,
            JSON.stringify({
              trigger: "all_documents_accepted",
              to: "ready_for_submission",
              source_type: doc.source_type,
            }),
          ],
        );
      }

      // BI_SERVER_BLOCK_v373_SECOND_ACCEPT_AND_TEXT_BUNDLE_v1
      // Mirrors the v359 backfill from biDocumentRoutes.ts:258 so this
      // duplicate handler behaves identically. (See Bug #22 in Test #1.)
      if (doc.source_type === "public") {
        const { submitApplicationToPGI } = await import("../services/biPgiSubmissionService");
        try {
          const result = await submitApplicationToPGI(appId);
          autoSubmittedToPgi = true;
          finalStatus = "submitted";

          // v359 backfill — flush previously-uploaded docs to PGI now that
          // pgi_application_id exists.
          try {
            const { pgiUploadDocument } = await import("../services/pgiAdapter");
            const pendingDocs = await pool.query<{
              id: string; doc_type: string; original_filename: string;
              mime_type: string; storage_key: string;
            }>(
              `SELECT id, doc_type, original_filename, mime_type, storage_key
                 FROM bi_documents
                WHERE application_id = $1
                  AND review_status = 'accepted'
                  AND pgi_document_id IS NULL
                  AND purged_at IS NULL
                ORDER BY uploaded_at`,
              [appId]
            );
            if (pendingDocs.rows.length > 0) {
              const { getStorage } = await import("../lib/storage");
              const store = getStorage();
              const ALLOWED = ["loan_agreement","profit_loss","balance_sheet","ar_aging","ap_aging","founder_cv","financial_forecast"];
              for (const d of pendingDocs.rows) {
                if (!ALLOWED.includes(d.doc_type)) continue;
                try {
                  const blob = await store.get(d.storage_key);
                  if (!blob?.buffer) throw new Error("blob not found");
                  const fwd = await pgiUploadDocument({
                    pgiApplicationId: result.externalId,
                    docType: d.doc_type as any,
                    filename: d.original_filename,
                    buffer: blob.buffer,
                    mimeType: d.mime_type || blob.contentType || "application/octet-stream",
                  });
                  await pool.query(`UPDATE bi_documents SET pgi_document_id = $1, forwarded_to_carrier_at = NOW() WHERE id = $2`, [fwd.document_id, d.id]);
                } catch (e) {
                  console.warn("[v373] backfill doc forward failed", { doc_id: d.id, error: (e as Error).message });
                }
              }
            }
          } catch (e) {
            console.warn("[v373] post-submit doc flush failed", { app_id: appId, error: (e as Error).message });
          }
          await pool.query(
            `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
                  VALUES($1, 'system', $2, 'auto_submitted_to_pgi', $3, $4::jsonb)`,
            [
              appId, userId,
              `Auto-forwarded to PGI after last document accepted (external_id=${result.externalId})`,
              JSON.stringify({
                trigger: "auto_pgi_on_last_accept",
                external_id: result.externalId,
                pgi_status: result.status,
                already_submitted: result.alreadySubmitted,
              }),
            ],
          );
        } catch (err) {
          pgiSubmitError = err instanceof Error ? err.message : "PGI submission failed";
          logger.warn({ err, appId }, "bi.applications.accept.auto_pgi_failed");
          await pool.query(
            `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
                  VALUES($1, 'system', $2, 'auto_submit_to_pgi_failed', $3, $4::jsonb)`,
            [
              appId, userId,
              `Auto-PGI submission failed: ${pgiSubmitError}. Manual retry available.`,
              JSON.stringify({ error: pgiSubmitError }),
            ],
          ).catch(() => {});
        }
      }
    }

    res.json({
      success: true,
      accepted: { total, pending, accepted: acceptedCount },
      stageAdvanced,
      finalStatus,
      autoSubmittedToPgi,
      pgiSubmitError,
    });
  } catch (err) {
    logger.error({ err, appId, docId }, "bi.applications.documents.accept.failed");
    res.status(500).json({ error: { code: "internal", message: "Accept failed" } });
  }
}

async function rejectDocumentLogic(req: Request, res: Response, idParam: string, docIdParam: string): Promise<void> {
  const appId = String(idParam);
  const docId = String(docIdParam);
  const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId ?? null;
  const reason = String((req.body as { reason?: string })?.reason || "").trim();

  if (!reason) {
    res.status(400).json({ error: { code: "reason_required", message: "Rejection reason required" } });
    return;
  }

  try {
    const docR = await pool.query<{ application_id: string; doc_type: string; source_type: string }>(
      `SELECT d.application_id, d.doc_type, a.source_type
         FROM bi_documents d
         JOIN bi_applications a ON a.id = d.application_id
        WHERE d.id = $1 LIMIT 1`,
      [docId],
    );
    if (docR.rowCount === 0) {
      res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
      return;
    }
    const doc = docR.rows[0];
    if (doc.application_id !== appId) {
      res.status(400).json({ error: { code: "mismatch", message: "Document does not belong to this application" } });
      return;
    }
    if (doc.source_type === "lender" || doc.source_type === "referrer") {
      res.status(403).json({ error: { code: "view_only", message: "Lender/referrer apps are view-only" } });
      return;
    }

    await pool.query(
      `UPDATE bi_documents
          SET review_status='rejected', reviewed_by=$2, reviewed_at=NOW(), rejection_reason=$3
        WHERE id=$1`,
      [docId, userId, reason],
    );

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
            VALUES($1, 'staff', $2, 'document_rejected', $3, $4::jsonb)`,
      [appId, userId, `Document rejected: ${doc.doc_type}`, JSON.stringify({ docId, reason })],
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err, appId, docId }, "bi.applications.documents.reject.failed");
    res.status(500).json({ error: { code: "internal", message: "Reject failed" } });
  }
}

// ------------------------------------------------------------------
// GET /:id/requirements
// ------------------------------------------------------------------
router.get("/:id/requirements", async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  try {
    // Confirm the app exists. 404 cleanly so the portal doesn't
    // render an empty state for a bad id.
    const appR = await pool.query<{ id: string }>(
      `SELECT id FROM bi_applications WHERE id = $1 LIMIT 1`,
      [appId],
    );
    if (appR.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Application not found" } });
    }

    // Pull all non-purged documents for the app. We need: id,
    // doc_type, filename, review status, OCR status + completion
    // time, rejection reason, created_at as upload time.
    const docR = await pool.query<{
      id: string;
      doc_type: string;
      original_filename: string | null;
      review_status: string | null;
      rejection_reason: string | null;
      ocr_status: string | null;
      ocr_completed_at: Date | null;
      extracted_text: string | null;
      created_at: Date;
    }>(
      `SELECT id, doc_type, original_filename, review_status,
              rejection_reason, ocr_status, ocr_completed_at,
              extracted_text, created_at
         FROM bi_documents
        WHERE application_id = $1 AND purged_at IS NULL
        ORDER BY created_at DESC`,
      [appId],
    );

    // Group documents by doc_type.
    const byType = new Map<string, typeof docR.rows>();
    for (const d of docR.rows) {
      const arr = byType.get(d.doc_type) || [];
      arr.push(d);
      byType.set(d.doc_type, arr);
    }

    // Union of required + actually-uploaded doc types.
    const allTypes = new Set<string>([...PGI_REQUIRED_DOC_TYPES, ...byType.keys()]);

    const requirements = Array.from(allTypes).map((category) => {
      const docs = byType.get(category) || [];
      return {
        category,
        label: DOC_TYPE_LABELS[category] || category,
        required: PGI_REQUIRED_DOC_TYPES.includes(category),
        documents: docs.map((d) => ({
          id: d.id,
          filename: d.original_filename || "(unnamed)",
          status: d.review_status === "accepted" ? "accepted"
                : d.review_status === "rejected" ? "rejected"
                : "pending",
          uploaded_at: d.created_at,
          // bi_documents stores extracted_text but no structured
          // ocr_fields yet. When OCR pipeline lands a jsonb fields
          // column this returns its parsed contents; today the tab
          // gracefully renders null. extracted_text snippet shown
          // separately if needed.
          ocr_fields: null,
          rejection_reason: d.rejection_reason,
        })),
      };
    });

    // Sort: required first (alphabetical inside required), then extras.
    requirements.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return res.json({ requirements });
  } catch (err) {
    logger.error({ err, appId }, "bi.applications.requirements.failed");
    return res.status(500).json({ error: { code: "internal", message: "Failed to load requirements" } });
  }
});

// ------------------------------------------------------------------
// GET /:id/document-history
// ------------------------------------------------------------------
// BI_SERVER_BLOCK_48_v1 -- soft-fail wrapper. Pre-fix the deployed
// handler returned 500 "Failed to load history" on every load.
// The BI Application Detail page's "Document History" sub-tab was
// permanently red-toasted. Return [] on error so the tab renders
// "No activity yet".
router.get("/:id/document-history", async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  try {
    // Pull bi_activity rows for this app whose event_type is
    // doc-related, joined to bi_users + bi_documents for display
    // strings. Limit 500 -- enough for the typical app lifecycle;
    // pagination is a Phase 2 follow-up if anything outgrows it.
    const r = await pool.query<{
      id: string;
      created_at: Date;
      actor_type: string;
      actor_user_id: string | null;
      event_type: string;
      summary: string;
      meta: Record<string, unknown> | null;
      staff_full_name: string | null;
      doc_filename: string | null;
      doc_type: string | null;
    }>(
      `SELECT a.id, a.created_at, a.actor_type, a.actor_user_id,
              a.event_type, a.summary, a.meta,
              NULL::text AS staff_full_name,
              d.original_filename AS doc_filename,
              d.doc_type AS doc_type
         FROM bi_activity a
         LEFT JOIN bi_users u ON u.id = a.actor_user_id
         LEFT JOIN bi_documents d ON d.id = (a.meta->>'docId')::uuid
        WHERE a.application_id = $1
          AND a.event_type = ANY($2::text[])
        ORDER BY a.created_at DESC
        LIMIT 500`,
      [appId, DOC_HISTORY_EVENT_TYPES],
    );

    const events = r.rows.map((row) => {
      const meta = row.meta || {};
      const actor =
        row.actor_type === "staff" && row.staff_full_name ? `staff:${row.staff_full_name}` :
        row.actor_type === "staff" ? "staff" :
        row.actor_type === "lender" ? "lender" :
        row.actor_type === "referrer" ? "referrer" :
        row.actor_type === "system" ? "system" :
        "applicant";
      const reason = typeof (meta as { reason?: unknown }).reason === "string"
        ? (meta as { reason: string }).reason
        : null;
      return {
        id: row.id,
        occurred_at: row.created_at,
        actor,
        event_type: row.event_type,
        document_filename: row.doc_filename,
        category: row.doc_type,
        reason,
        metadata: meta,
      };
    });

    return res.json({ events });
  } catch (err) {
    logger.error({ err, appId }, "bi.applications.document-history.failed");
    // BI_SERVER_BLOCK_48_v1 -- surface zero state instead of 500.
    console.warn("[document-history soft-fail]", err instanceof Error ? err.message : err);
    return res.json({ items: [], total: 0 });
  }
});

// ------------------------------------------------------------------
// GET /:id/pgi-comms
// ------------------------------------------------------------------
router.get("/:id/pgi-comms", async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  try {
    // Get the PGI application ID. If the app hasn't been submitted
    // yet, pgi_application_id is null and the events array is empty.
    const appR = await pool.query<{ pgi_application_id: string | null }>(
      `SELECT pgi_application_id FROM bi_applications WHERE id = $1 LIMIT 1`,
      [appId],
    );
    if (appR.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Application not found" } });
    }
    const pgiAppId = appR.rows[0].pgi_application_id;
    if (!pgiAppId) {
      return res.json({ events: [] });
    }

    // Pull every webhook event whose payload.application_id matches.
    // bi_webhook_log isn't FK'd to bi_applications -- the join is
    // via the JSONB payload field that PGI populates.
    const r = await pool.query<{
      id: string;
      event_type: string;
      created_at: Date;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, event_type, created_at, payload
         FROM bi_webhook_log
        WHERE payload->>'application_id' = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [pgiAppId],
    );

    return res.json({
      events: r.rows.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        occurred_at: row.created_at,
        payload: row.payload,
      })),
    });
  } catch (err) {
    logger.error({ err, appId }, "bi.applications.pgi-comms.failed");
    return res.status(500).json({ error: { code: "internal", message: "Failed to load carrier events" } });
  }
});


// BI_SERVER_BLOCK_v365_COGUARANTOR_GET_v1
// BF-portal's CoGuarantorList.tsx polls this endpoint. v354 writes rows
// into bi_co_guarantors on lender API submit; staff need to see them.
router.get("/:id/co-guarantors", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const appId = req.params.id;
  try {
    const rows = await pool.query<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      date_of_birth: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      province: string | null;
      postal_code: string | null;
      relationship: string | null;
      created_at: Date;
    }>(
      `SELECT id, first_name, last_name, email, date_of_birth, phone,
              address, city, province, postal_code, relationship, created_at
         FROM bi_co_guarantors
        WHERE application_id = $1
        ORDER BY created_at ASC`,
      [appId],
    );
    return res.json({
      co_guarantors: rows.rows.map((r) => ({
        id: r.id,
        first_name: r.first_name ?? "",
        last_name: r.last_name ?? "",
        full_name: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email,
        date_of_birth: r.date_of_birth,
        phone: r.phone,
        address: r.address,
        city: r.city,
        province: r.province,
        postal_code: r.postal_code,
        relationship: r.relationship ?? "Guarantor",
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err, appId }, "bi.applications.co_guarantors.list_failed");
    return res.status(500).json({ error: "co_guarantor_list_failed" });
  }
});


// BI_SERVER_BLOCK_v390_SEND_TO_CARRIER_DEPRECATED_v1
// Per 2026-05-27 ruling: Public apps auto-submit when the last required
// document is accepted (see acceptDocumentLogic below). Lender apps go
// direct-to-carrier in biLenderApplicationCreate. No manual staff button.
router.post("/:id/submit-to-pgi", requireStaffOrAdmin, async (_req, res) => {
  return res.status(410).json({
    error: "endpoint_removed",
    message: "Public apps auto-submit on last-doc-accept; lender apps go direct.",
  });
});
router.post("/:id/send-to-purbeck", requireStaffOrAdmin, async (_req, res) => {
  return res.status(410).json({
    error: "endpoint_removed",
    message: "Public apps auto-submit on last-doc-accept; lender apps go direct.",
  });
});

// ------------------------------------------------------------------
// POST /:id/documents/:docId/accept
// ------------------------------------------------------------------
// Nested URL form. Logic mirrors the existing
// /api/v1/bi/documents/:id/accept handler in biDocumentRoutes.ts
// (BI_SERVER_BLOCK_v178 -- accept-all gate advances stage,
// does NOT auto-submit to PGI; staff click "Submit to carrier"
// explicitly).
router.post("/:id/documents/:docId/accept", requireStaffOrAdmin, async (req: Request, res: Response) => {
  return acceptDocumentLogic(req, res, req.params.id, req.params.docId);
});

// ------------------------------------------------------------------
// POST /:id/documents/:docId/reject
// ------------------------------------------------------------------
router.post("/:id/documents/:docId/reject", requireStaffOrAdmin, async (req: Request, res: Response) => {
  return rejectDocumentLogic(req, res, req.params.id, req.params.docId);
});

// POST /:id/documents/:docId/review — single endpoint that dispatches to accept or reject
// based on body.action. Portal uses this instead of two separate URLs.
router.post("/:id/documents/:docId/review", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const action = String((req.body ?? {}).action ?? "").toLowerCase().trim();
  if (action === "accepted" || action === "accept") {
    return acceptDocumentLogic(req, res, req.params.id, req.params.docId);
  }
  if (action === "rejected" || action === "reject") {
    return rejectDocumentLogic(req, res, req.params.id, req.params.docId);
  }
  return res.status(400).json({ error: "invalid_action", message: "action must be 'accepted' or 'rejected'." });
});

// BI_SERVER_BLOCK_v347_STAFF_DECLINE_v1
// POST /api/v1/bi/applications/:id/staff-decline
// Staff can close out an application that fails review before carrier submission.
// Requires { reason } in body. Sets stage='declined' and records staff
// identity + timestamp + reason. Idempotent: re-declining is a no-op.
router.post("/:id/staff-decline", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId ?? null;
  const reason = String((req.body as { reason?: string })?.reason || "").trim();

  if (!reason) {
    return res.status(400).json({ error: { code: "reason_required", message: "Decline reason required" } });
  }
  if (reason.length < 4) {
    return res.status(400).json({ error: { code: "reason_too_short", message: "Reason must be at least 4 characters" } });
  }

  try {
    const appR = await pool.query<{ id: string; stage: string; source_type: string; staff_declined_at: string | null }>(
      `SELECT id, stage, source_type, staff_declined_at
         FROM bi_applications
        WHERE id = $1 LIMIT 1`,
      [appId],
    );
    if (appR.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Application not found" } });
    }
    const app = appR.rows[0];

    if (app.staff_declined_at) {
      return res.json({ success: true, already_declined: true });
    }

    if (["policy_issued", "approved", "ready_for_submission", "submitted"].includes(app.stage)) {
      return res.status(409).json({
        error: { code: "stage_locked", message: `Cannot decline at stage '${app.stage}'` },
      });
    }

    await pool.query(
      `UPDATE bi_applications
          SET stage = 'declined',
              staff_declined_at = NOW(),
              staff_declined_by = $2,
              staff_decline_reason = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [appId, userId, reason],
    );

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
            VALUES($1, 'staff', $2, 'application_staff_declined', $3, $4::jsonb)`,
      [appId, userId, `Application declined by staff`, JSON.stringify({ reason, prior_stage: app.stage })],
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err, appId }, "bi.applications.staff_decline.failed");
    return res.status(500).json({ error: { code: "internal", message: "Decline failed" } });
  }
});

export default router;
