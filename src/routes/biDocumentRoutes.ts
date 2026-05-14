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

router.get("/:id", async (req, res) => {
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
  // BI_SERVER_BLOCK_v178_DOC_ACCEPT_HARDENING_v1
  // Auto-PGI removed — v160 Submit-to-Carrier endpoint is now the only
  // path to carrier. On accept-all we ONLY advance the stage so the
  // manual button surfaces in the BI portal.
  let stageAdvanced = false;
  let nextStage: "document_review" | "ready_for_submission" | null = null;
  if (acceptedCount > 0 && pending === 0) {
    const stageRow = await pool.query<{ source_type: string | null; status: string | null }>(
      `SELECT source_type, status FROM bi_applications WHERE id=$1 LIMIT 1`,
      [doc.application_id]
    );
    const srcType = String(stageRow.rows[0]?.source_type ?? "").toLowerCase();
    const currentStatus = String(stageRow.rows[0]?.status ?? "").toLowerCase();
    nextStage = srcType === "lender" ? "ready_for_submission" : "document_review";
    if (currentStatus === "in_progress") {
      const updated = await pool.query(
        `UPDATE bi_applications
            SET status=$2, updated_at=NOW()
          WHERE id=$1 AND status='in_progress'`,
        [doc.application_id, nextStage]
      );
      stageAdvanced = (updated.rowCount ?? 0) > 0;
    }
    if (stageAdvanced) {
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
         VALUES($1, 'system', $2, 'application_stage_changed', $3, $4::jsonb)`,
        [
          doc.application_id,
          userId,
          `Application advanced to ${nextStage} after all documents were accepted`,
          JSON.stringify({ trigger: "all_documents_accepted", from: "in_progress", to: nextStage }),
        ]
      );
    }
  }

  // BI_SERVER_BLOCK_v276_REJECTED_DOCS_DONT_BLOCK_GATE_v1 — include accepted
  return ok(res, { success: true, accepted: { total, pending, accepted: acceptedCount }, stageAdvanced, nextStage });
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


// BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
// Local runOcrForDocument moved to src/services/ocrRunner.ts.
// Module-local `pool` here is the legacy per-route Pool — runOcrForDocument
// uses the shared db pool (see ocrRunner.ts).

export default router;
