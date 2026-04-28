import { Router } from "express";
import multer from "multer";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { badRequest, ok } from "../utils/apiResponse";
import { sendDocumentRejectedSms } from "../services/smsService";
import { requireAuth } from "../platform/auth";
import { env } from "../platform/env";
// BI_HARDENING_v44 — switch BI document storage from local disk to the Azure
// Blob abstraction. Memory storage so multer doesn't write to disk first.
import { getStorage } from "../lib/storage";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

// Legacy local-disk fallback path. Kept ONLY so /:id (download) can still serve
// pre-blob documents written before this block deployed. New uploads no longer
// land here.
const legacyUploadDir = path.join(__dirname, "../../uploads/bi");
if (!fs.existsSync(legacyUploadDir)) fs.mkdirSync(legacyUploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
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
  }

  ok(res, { success: true, files: created });
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


router.post("/:id/accept", requireAuth, async (req, res) => {
  // BI_HARDENING_v44 — BI-7. After marking this doc accepted, check whether all
  // documents on the application are accepted. If yes (and at least one exists),
  // auto-forward to PGI. submitApplicationToPGI is idempotent (alreadySubmitted).
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

  // BI_HARDENING_v44 — accept-all gate. total > 0 AND every row is accepted.
  const counts = await pool.query<{ pending: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE review_status IS DISTINCT FROM 'accepted') AS pending,
       COUNT(*) AS total
     FROM bi_documents
     WHERE application_id = $1 AND purged_at IS NULL`,
    [doc.application_id]
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const pending = Number(counts.rows[0]?.pending ?? 0);
  let pgiResult: { externalId: string; status: string; alreadySubmitted: boolean } | null = null;
  if (total > 0 && pending === 0) {
    try {
      pgiResult = await submitApplicationToPGI(doc.application_id);
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
         VALUES($1, 'system', $2, 'pgi_submitted', $3, $4::jsonb)`,
        [
          doc.application_id,
          userId,
          `Auto-forwarded to PGI`,
          JSON.stringify({ trigger: "all_documents_accepted", external_id: pgiResult?.externalId ?? null }),
        ]
      );
    } catch (err) {
      // Don't fail the staff-accept request because PGI is down. Log and move on.
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
         VALUES($1, 'system', $2, 'pgi_submit_failed', $3, $4::jsonb)`,
        [doc.application_id, userId, "PGI auto-submit failed", JSON.stringify({ error: String(err) })]
      );
    }
  }

  return ok(res, { success: true, pgi: pgiResult, accepted: { total, pending } });
});

router.post("/:id/reject", requireAuth, async (req, res) => {
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

export default router;
