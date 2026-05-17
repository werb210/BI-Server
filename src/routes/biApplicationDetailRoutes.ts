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
              u.full_name AS staff_full_name,
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
    return res.status(500).json({ error: { code: "internal", message: "Failed to load history" } });
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

// ------------------------------------------------------------------
// POST /:id/documents/:docId/accept
// ------------------------------------------------------------------
// Nested URL form. Logic mirrors the existing
// /api/v1/bi/documents/:id/accept handler in biDocumentRoutes.ts
// (BI_SERVER_BLOCK_v178 -- accept-all gate advances stage,
// does NOT auto-submit to PGI; staff click "Submit to carrier"
// explicitly).
router.post("/:id/documents/:docId/accept", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  const docId = String(req.params.docId);
  const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId ?? null;

  try {
    // Verify the doc actually belongs to this application -- the
    // nested URL implies that constraint, so reject any mismatched
    // call rather than silently accepting a sibling doc.
    const docR = await pool.query<{ application_id: string; doc_type: string; source_type: string }>(
      `SELECT d.application_id, d.doc_type, a.source_type
         FROM bi_documents d
         JOIN bi_applications a ON a.id = d.application_id
        WHERE d.id = $1 LIMIT 1`,
      [docId],
    );
    if (docR.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    }
    const doc = docR.rows[0];
    if (doc.application_id !== appId) {
      return res.status(400).json({ error: { code: "mismatch", message: "Document does not belong to this application" } });
    }
    // Lender + referrer apps auto-forward; staff don't review docs
    // on those. The portal hides the accept button (Block 31), but
    // belt-and-suspenders here too.
    if (doc.source_type === "lender" || doc.source_type === "referrer") {
      return res.status(403).json({ error: { code: "view_only", message: "Lender/referrer apps are view-only" } });
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

    // Accept-all gate (BI_SERVER_BLOCK_v178). >=1 accepted AND no
    // pending. Rejected docs neither block nor advance.
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
    let nextStage: "document_review" | "ready_for_submission" | null = null;
    if (acceptedCount > 0 && pending === 0) {
      // Public source -> document_review (staff still review).
      // Lender source -> ready_for_submission (already guarded above
      // but kept for completeness if the rule loosens later).
      nextStage = doc.source_type === "lender" ? "ready_for_submission" : "document_review";
      const updated = await pool.query(
        `UPDATE bi_applications
            SET status=$2, updated_at=NOW()
          WHERE id=$1 AND status='in_progress'`,
        [appId, nextStage],
      );
      stageAdvanced = (updated.rowCount ?? 0) > 0;
      if (stageAdvanced) {
        await pool.query(
          `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
                VALUES($1, 'system', $2, 'application_stage_changed', $3, $4::jsonb)`,
          [
            appId, userId,
            `Application advanced to ${nextStage} after all documents were accepted`,
            JSON.stringify({ trigger: "all_documents_accepted", from: "in_progress", to: nextStage }),
          ],
        );
      }
    }

    return res.json({
      success: true,
      accepted: { total, pending, accepted: acceptedCount },
      stageAdvanced,
      nextStage,
    });
  } catch (err) {
    logger.error({ err, appId, docId }, "bi.applications.documents.accept.failed");
    return res.status(500).json({ error: { code: "internal", message: "Accept failed" } });
  }
});

// ------------------------------------------------------------------
// POST /:id/documents/:docId/reject
// ------------------------------------------------------------------
router.post("/:id/documents/:docId/reject", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const appId = String(req.params.id);
  const docId = String(req.params.docId);
  const userId = (req as { user?: { staffUserId?: string } }).user?.staffUserId ?? null;
  const reason = String((req.body as { reason?: string })?.reason || "").trim();

  if (!reason) {
    return res.status(400).json({ error: { code: "reason_required", message: "Rejection reason required" } });
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
      return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    }
    const doc = docR.rows[0];
    if (doc.application_id !== appId) {
      return res.status(400).json({ error: { code: "mismatch", message: "Document does not belong to this application" } });
    }
    if (doc.source_type === "lender" || doc.source_type === "referrer") {
      return res.status(403).json({ error: { code: "view_only", message: "Lender/referrer apps are view-only" } });
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

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err, appId, docId }, "bi.applications.documents.reject.failed");
    return res.status(500).json({ error: { code: "internal", message: "Reject failed" } });
  }
});

export default router;
