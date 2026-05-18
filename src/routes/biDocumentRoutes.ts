import { Router } from "express";
import multer from "multer";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { badRequest, ok } from "../utils/apiResponse";
import { sendDocumentRejectedSms } from "../services/smsService";
import { requireAuth } from "../platform/auth";
import { env } from "../platform/env";
// BI_HARDENING_v44 — switch BI document storage from local disk to the Azure
// Blob abstraction. Memory storage so multer doesn't write to disk first.
import { getStorage } from "../lib/storage";
// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER / BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
// runOcrForDocument moved into shared service so public-flow uploads
// can call the same code. extractText import retained because other
// code paths in this file may still reference it directly.
import { extractText } from "../services/ocrService";
import { runOcrForDocument } from "../services/ocrRunner";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

// BI_SERVER_BLOCK_v178_DOC_ACCEPT_HARDENING_v1
// Inline role gate — biDocumentRoutes does not import a role middleware
// (auth.ts only exports requireAuth). Reject non-staff/non-admin.
function requireStaffOrAdmin(req: any, res: any, next: any) {
  const role = String((req.user as { role?: string } | undefined)?.role ?? "").toLowerCase();
  if (role !== "admin" && role !== "staff") {
    return res.status(403).json({ status: "error", error: "STAFF_OR_ADMIN_ONLY" });
  }
  next();
}

// Legacy local-disk fallback path. Kept ONLY so /:id (download) can still serve
// pre-blob documents written before this block deployed. New uploads no longer
// land here.
const legacyUploadDir = path.join(__dirname, "../../uploads/bi");
// BI_BOOT_FIX_v63_DOC_DIR — wwwroot can be read-only on Azure when
// WEBSITE_RUN_FROM_PACKAGE=1 is set. mkdirSync would throw at module
// load and crash the entire BI-Server boot. Tolerate the failure;
// uploads have moved to Azure Blob anyway.
try {
  if (!fs.existsSync(legacyUploadDir)) {
    fs.mkdirSync(legacyUploadDir, { recursive: true });
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn("[BI_BOOT_FIX_v63_DOC_DIR] legacy upload dir not creatable (ok — Azure Blob is primary):", err instanceof Error ? err.message : err);
}

// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — 5 MB per file per PGI carrier policy.
// Image / PDF / Excel / Word / screenshots all accepted. Per user: do not
// reject by MIME — store everything, OCR figures out what to do.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/:id/documents", upload.array("files"), async (req, res) => {
  // BI_HARDENING_v44 — uploads go to Azure Blob (storage abstraction).
  // PGI auto-forward removed from this handler — it now fires from /:id/accept
  // when every required document for the application has been accepted (BI-7).
  const { id } = req.params;
  const files = (req.files as Express.Multer.File[]) ?? [];
  const docTypesRaw = req.body?.doc_types;
  const docTypes = Array.isArray(docTypesRaw) ? docTypesRaw : typeof docTypesRaw === "string" ? [docTypesRaw] : [];
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const store = getStorage();

  const created: Array<{ id: string; fileUrl: string }> = [];

  for (const [idx, file] of files.entries()) {
    const docType = typeof docTypes[idx] === "string" && docTypes[idx].trim() ? docTypes[idx].trim() : "other";
    const put = await store.put({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      pathPrefix: `applications/${id}`,
    });
    const inserted = await pool.query(
      `INSERT INTO bi_documents
      (application_id, doc_type, original_filename, storage_key, blob_name, blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'applicant')
      RETURNING id`,
      [id, docType, file.originalname, put.blobName, put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes]
    );

    const docId = inserted.rows[0].id as string;
    created.push({ id: docId, fileUrl: `${baseUrl}/api/v1/bi/documents/${docId}` });

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','document_uploaded',$2)`,
      [id, `Document uploaded: ${file.originalname}`]
    );

    // BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — fire-and-forget OCR.
    void runOcrForDocument(docId, file).catch(() => { /* logged inside */ });
  }

  ok(res, { success: true, files: created });
});

// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — required-doc catalog endpoint.
// Mounted at /api/v1/bi/required-documents (see OP 5 for the secondary mount).
router.get("/required-documents", async (_req, res) => {
  const result = await pool.query(
    `SELECT doc_type, display_label, description, if_startup, sort_order
     FROM bi_required_doc_catalog
     WHERE active = TRUE
     ORDER BY sort_order ASC`
  );
  ok(res, { documents: result.rows });
});

router.get("/:id", async (req, res, next) => {
  // BI_SERVER_BLOCK_v247_BI_API_FIXES_v1 -- UUID guard. This router is
  // ALSO mounted at the bare /api/v1/bi prefix (server.ts line 259) for
  // legacy callers, which means non-UUID paths like /carrier-health,
  // /admin/referrers, /crm/contacts etc. would hit THIS handler with
  // req.params.id="carrier-health" and crash the SQL query with
  // "invalid input syntax for type uuid". Skip + next() if :id doesn't
  // look like a UUID, letting downstream routers try.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id ?? "")) {
    return next();
  }
  // BI_HARDENING_v44 — prefer blob_name (new uploads); fall back to legacy disk
  // path for documents written before this block.
  const result = await pool.query(
    `SELECT original_filename, storage_key, blob_name, mime_type FROM bi_documents WHERE id=$1 AND purged_at IS NULL LIMIT 1`,
    [req.params.id]
  );

  if (!result.rows.length) return badRequest(res, "Document not found");

  const row = result.rows[0] as {
    original_filename: string;
    storage_key: string | null;
    blob_name: string | null;
    mime_type: string;
  };

  if (row.blob_name) {
    const got = await getStorage().get(row.blob_name);
    if (!got) return badRequest(res, "File missing");
    res.setHeader("Content-Type", row.mime_type || got.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.original_filename}"`);
    return res.end(got.buffer);
  }

  // Legacy disk path.
  if (!row.storage_key) return badRequest(res, "File missing");
  const fullPath = path.join(legacyUploadDir, row.storage_key);
  if (!fs.existsSync(fullPath)) return badRequest(res, "File missing");
  res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${row.original_filename}"`);
  return fs.createReadStream(fullPath).pipe(res);
});


router.post("/:id/accept", requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const userId = (req.user as { staffUserId?: string } | undefined)?.staffUserId ?? null;

  const docResult = await pool.query(
    `SELECT application_id, doc_type FROM bi_documents WHERE id=$1 LIMIT 1`,
    [id]
  );
  if (!docResult.rows.length) return badRequest(res, "Document not found");
  const doc = docResult.rows[0];

  await pool.query(
    `UPDATE bi_documents
        SET review_status='accepted', reviewed_by=$2, reviewed_at=NOW()
      WHERE id=$1`,
    [id, userId]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES($1, 'staff', $2, 'document_accepted', $3, $4::jsonb)`,
    [doc.application_id, userId, `Document accepted: ${doc.doc_type}`, JSON.stringify({ docId: id })]
  );

  // BI_HARDENING_v44 / BI_SERVER_BLOCK_v276_REJECTED_DOCS_DONT_BLOCK_GATE_v1
  // Accept-all gate. ≥1 accepted doc AND no pending docs. 'rejected'
  // rows are neither — they stay visible in the docs tab so staff
  // can see the rejection history but don't block the gate after a
  // replacement is accepted.
  const counts = await pool.query<{ pending: string; accepted: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(review_status, 'pending') NOT IN ('accepted', 'rejected')) AS pending,
       COUNT(*) FILTER (WHERE review_status = 'accepted') AS accepted,
       COUNT(*) AS total
     FROM bi_documents
     WHERE application_id = $1 AND purged_at IS NULL`,
    [doc.application_id]
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const pending = Number(counts.rows[0]?.pending ?? 0);
  const acceptedCount = Number(counts.rows[0]?.accepted ?? 0);
  // BI_SERVER_BLOCK_BI_ROUND8_AUTOFWD_v1 -- restores auto-PGI on
  // accept-all for public-source apps. Reverts v178. Lender +
  // referrer paths already auto-submit at application creation
  // (Block 27); they advance to ready_for_submission here as a
  // safety net but submitApplicationToPGI's idempotent claim makes
  // any duplicate fire a no-op.
  let stageAdvanced = false;
  let finalStatus: string | null = null;
  let autoSubmittedToPgi = false;
  let pgiSubmitError: string | null = null;

  if (acceptedCount > 0 && pending === 0) {
    const stageRow = await pool.query<{ source_type: string | null; status: string | null }>(
      `SELECT source_type, status FROM bi_applications WHERE id=$1 LIMIT 1`,
      [doc.application_id]
    );
    const srcType = String(stageRow.rows[0]?.source_type ?? "").toLowerCase();

    const advance = await pool.query(
      `UPDATE bi_applications
          SET status = 'ready_for_submission', updated_at = NOW()
        WHERE id = $1
          AND status IN ('in_progress', 'document_review')
        RETURNING id`,
      [doc.application_id]
    );
    stageAdvanced = (advance.rowCount ?? 0) > 0;
    finalStatus = stageAdvanced ? "ready_for_submission" : null;

    if (stageAdvanced) {
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
         VALUES($1, 'system', $2, 'application_stage_changed', $3, $4::jsonb)`,
        [
          doc.application_id, userId,
          `Application advanced to ready_for_submission after all documents accepted`,
          JSON.stringify({
            trigger: "all_documents_accepted",
            to: "ready_for_submission",
            source_type: srcType,
          }),
        ]
      );
    }

    if (srcType === "public") {
      const { submitApplicationToPGI } = await import("../services/biPgiSubmissionService");
      try {
        const result = await submitApplicationToPGI(doc.application_id);
        autoSubmittedToPgi = true;
        finalStatus = "submitted";
        await pool.query(
          `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
           VALUES($1, 'system', $2, 'auto_submitted_to_pgi', $3, $4::jsonb)`,
          [
            doc.application_id, userId,
            `Auto-forwarded to PGI after last document accepted (external_id=${result.externalId})`,
            JSON.stringify({
              trigger: "auto_pgi_on_last_accept",
              external_id: result.externalId,
              pgi_status: result.status,
              already_submitted: result.alreadySubmitted,
            }),
          ]
        );
      } catch (err) {
        pgiSubmitError = err instanceof Error ? err.message : "PGI submission failed";
        console.warn("[BI_ROUND8_AUTOFWD] auto-PGI submission failed", { appId: doc.application_id, err });
        await pool.query(
          `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
           VALUES($1, 'system', $2, 'auto_submit_to_pgi_failed', $3, $4::jsonb)`,
          [
            doc.application_id, userId,
            `Auto-PGI submission failed: ${pgiSubmitError}. Manual retry available.`,
            JSON.stringify({ error: pgiSubmitError }),
          ]
        ).catch(() => {});
      }
    }
  }

  return ok(res, {
    success: true,
    accepted: { total, pending, accepted: acceptedCount },
    stageAdvanced,
    finalStatus,
    autoSubmittedToPgi,
    pgiSubmitError,
  });
});

router.post("/:id/reject", requireAuth, requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };
  const userId = (req.user as { staffUserId?: string } | undefined)?.staffUserId ?? null;

  if (!reason || !reason.trim()) {
    return badRequest(res, "Rejection reason is required");
  }

  const docResult = await pool.query(
    `SELECT d.application_id, d.doc_type,
            c.full_name AS contact_name,
            a.applicant_phone_e164 AS contact_phone
       FROM bi_documents d
       JOIN bi_applications a ON a.id = d.application_id
  LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
      WHERE d.id=$1
      LIMIT 1`,
    [id]
  );
  if (!docResult.rows.length) return badRequest(res, "Document not found");
  const doc = docResult.rows[0];

  await pool.query(
    `UPDATE bi_documents
        SET review_status='rejected', reviewed_by=$2, reviewed_at=NOW(), rejection_reason=$3
      WHERE id=$1`,
    [id, userId, reason.trim()]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES($1, 'staff', $2, 'document_rejected', $3, $4::jsonb)`,
    [
      doc.application_id,
      userId,
      `Document rejected: ${doc.doc_type}`,
      JSON.stringify({ docId: id, reason: reason.trim() })
    ]
  );

  if (doc.contact_phone) {
    const portalBase = process.env.APPLICANT_PORTAL_URL || "https://borealinsurance.ca";
    const link = `${portalBase}/application/documents?app=${doc.application_id}`;
    try {
      const smsResult = await sendDocumentRejectedSms(doc.contact_phone, {
        name: doc.contact_name || "there",
        docType: doc.doc_type,
        reason: reason.trim(),
        link
      });
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
         VALUES($1, 'system', $2, 'sms_sent', $3, $4::jsonb)`,
        [
          doc.application_id,
          userId,
          `SMS sent for rejected doc ${doc.doc_type}`,
          JSON.stringify({ template: "document_rejected", to: doc.contact_phone, sid: (smsResult as { sid?: string }).sid ?? null })
        ]
      );
    } catch (smsErr) {
      console.error("SMS send failed for doc reject", smsErr);
    }
  }

  return ok(res, { success: true });
});


// BI_SERVER_BLOCK_75_DOC_DOWNLOAD_DELETE_v1
// GET /:id/download - companion to GET /:id; forces attachment disposition.
// Same UUID guard pattern as GET /:id (router is also mounted at the bare
// /api/v1/bi prefix per server.ts:259, so non-UUID paths must fall through).
router.get("/:id/download", async (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id ?? "")) {
    return next();
  }
  const result = await pool.query(
    `SELECT original_filename, storage_key, blob_name, mime_type FROM bi_documents WHERE id=$1 AND purged_at IS NULL LIMIT 1`,
    [req.params.id]
  );
  if (!result.rows.length) return badRequest(res, "Document not found");
  const row = result.rows[0] as {
    original_filename: string;
    storage_key: string | null;
    blob_name: string | null;
    mime_type: string;
  };
  const safeName = String(row.original_filename || "document").replace(/[\r\n"\\]/g, "_");
  if (row.blob_name) {
    const got = await getStorage().get(row.blob_name);
    if (!got) return badRequest(res, "File missing");
    res.setHeader("Content-Type", row.mime_type || got.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    return res.end(got.buffer);
  }
  if (!row.storage_key) return badRequest(res, "File missing");
  const fullPath = path.join(legacyUploadDir, row.storage_key);
  if (!fs.existsSync(fullPath)) return badRequest(res, "File missing");
  res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  return fs.createReadStream(fullPath).pipe(res);
});

// DELETE /:id - soft-delete. Sets purged_at; existing SELECTs filter on
// purged_at IS NULL, so the doc disappears from staff UI without touching
// blob storage (a sweeper can purge later). Staff-or-admin only.
router.delete("/:id", requireAuth, requireStaffOrAdmin, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id ?? "")) {
    return badRequest(res, "Invalid document id");
  }
  const userId = String((req.user as { id?: string } | undefined)?.id ?? "") || null;
  const r = await pool.query(
    `UPDATE bi_documents
        SET purged_at = NOW()
      WHERE id = $1 AND purged_at IS NULL
      RETURNING id, application_id, doc_type`,
    [req.params.id]
  );
  if (!r.rows.length) return badRequest(res, "Document not found or already deleted");
  const row = r.rows[0] as { id: string; application_id: string; doc_type: string };
  await pool.query(
    `INSERT INTO bi_activity (application_id, actor, actor_user_id, kind, message, metadata)
     VALUES ($1, 'staff', $2, 'document_deleted', $3, $4::jsonb)`,
    [row.application_id, userId, `Document deleted: ${row.doc_type}`, JSON.stringify({ docId: row.id })]
  ).catch(() => {});
  return ok(res, { success: true, id: row.id });
});


// BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
// Local runOcrForDocument moved to src/services/ocrRunner.ts.
// Module-local `pool` here is the legacy per-route Pool — runOcrForDocument
// uses the shared db pool (see ocrRunner.ts).

export default router;
