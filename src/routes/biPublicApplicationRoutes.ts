// BI_AUDIT_FIX_v58 — public-facing PGI application endpoints.
//
// These three POSTs power the unauthenticated 3-page flow on the BI website:
//   POST /applications/public         create application from validated PGI submission
//   POST /applications/:id/documents  upload required documents
//   POST /applications/:id/sign       record T&C acceptance + typed signature
//
// Auth replacement: a "draft gate" enforces that mutating endpoints only
// accept records that are still applicant-editable:
//   source_type        = 'public'
//   submission_locked  = FALSE
//   created_at         > NOW() - INTERVAL '7 days'
// This bounds drive-by writes against guessed UUIDs to a 7-day window per
// application — once staff lock the record (or 7 days pass), public mutations
// are rejected even with a valid id.

import { Router } from "express";
import multer from "multer";
import { pool } from "../db";
import { validatePgiSubmission } from "../lib/validation/pgiFields";
import { mirrorToContact } from "../services/crmMirrorService";
import { notifyStaff } from "../services/staffNotifyService";
import { getStorage } from "../lib/storage";
import { ok, badRequest } from "../utils/apiResponse";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

type DraftAppRow = { id: string; source_type: string; submission_locked: boolean };

async function loadPublicDraftApp(id: string): Promise<DraftAppRow | null> {
  const r = await pool.query<DraftAppRow>(
    `SELECT id, source_type, submission_locked
       FROM bi_applications
      WHERE id = $1
        AND source_type = 'public'
        AND submission_locked = FALSE
        AND created_at > NOW() - INTERVAL '7 days'
      LIMIT 1`,
    [id]
  );
  return r.rows[0] ?? null;
}

router.post("/applications/public", async (req, res) => {
  const v = validatePgiSubmission(req.body);
  if (!v.ok) {
    return res.status(400).json({ ok: false, error: "PGI_VALIDATION_FAILED", issues: v.issues });
  }

  try {
    const insert = await pool.query<{ id: string }>(
      `INSERT INTO bi_applications (
         created_by_actor, created_by_lender_id, source_type, docs_review_required,
         applicant_phone_e164, stage, data,
         guarantor_name, guarantor_email, lender_name
       ) VALUES (
         'applicant', NULL, 'public', TRUE,
         '+10000000000', 'new_application'::bi_pipeline_stage, $1::jsonb,
         $2, $3, $4
       )
       RETURNING id`,
      [
        JSON.stringify({
          ...v.value.form_data,
          business_name: v.value.business_name,
          lender_name: v.value.lender_name ?? null,
        }),
        v.value.guarantor_name,
        v.value.guarantor_email,
        v.value.lender_name ?? null,
      ]
    );
    const id = insert.rows[0]!.id;

    await mirrorToContact({
      source: "applicant",
      full_name: v.value.guarantor_name,
      email: v.value.guarantor_email,
      company_name: v.value.business_name,
      lifecycle_stage: "applicant",
      extra_tags: [`application:${id}`],
    });
    void notifyStaff(
      "new_application",
      `New public BI application: ${v.value.business_name}`
    ).catch(() => {});

    return res.status(201).json({
      ok: true,
      application_id: id,
      source: "public",
      awaiting: "internal_review",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "PERSIST_FAILED",
      message: err instanceof Error ? err.message : "unknown",
    });
  }
});

router.post("/applications/:id/documents", upload.array("files"), async (req, res) => {
  const { id } = req.params;
  const draft = await loadPublicDraftApp(id);
  if (!draft) return res.status(403).json({ ok: false, error: "NOT_A_PUBLIC_DRAFT" });

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) return badRequest(res, "No files");

  // BI_DOC_LIST_v61 — front-end now sends doc_slots[] + period_ends[] aligned
  // with files[]. Legacy doc_types[] is still accepted for back-compat but
  // treated as doc_slot.
  const docSlotsRaw = (req.body?.doc_slots ?? req.body?.doc_types) as unknown;
  const docSlots: string[] = Array.isArray(docSlotsRaw)
    ? (docSlotsRaw as string[])
    : typeof docSlotsRaw === "string"
    ? [docSlotsRaw]
    : [];
  const periodEndsRaw = req.body?.period_ends as unknown;
  const periodEnds: (string | null)[] = Array.isArray(periodEndsRaw)
    ? (periodEndsRaw as string[]).map((v) => (typeof v === "string" && v ? v : null))
    : [];

  const store = getStorage();
  const created: Array<{ id: string }> = [];

  for (const [idx, file] of files.entries()) {
    const slot =
      typeof docSlots[idx] === "string" && docSlots[idx]!.trim()
        ? docSlots[idx]!.trim()
        : "other";
    const periodEnd = periodEnds[idx] ?? null;
    const put = await store.put({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      pathPrefix: `applications/${id}`,
    });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bi_documents
         (application_id, doc_type, doc_slot, period_end,
          original_filename, storage_key, blob_name,
          blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'applicant')
       RETURNING id`,
      [id, slot, slot, periodEnd, file.originalname, put.blobName, put.blobName, put.url, put.hash, file.mimetype, put.sizeBytes]
    );
    created.push({ id: inserted.rows[0]!.id });

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES ($1, 'applicant', 'document_uploaded', $2)`,
      [id, `Document uploaded: ${file.originalname}`]
    );
  }

  return ok(res, { success: true, files: created });
});

router.post("/applications/:id/sign", async (req, res) => {
  const { id } = req.params;
  const draft = await loadPublicDraftApp(id);
  if (!draft) return res.status(403).json({ ok: false, error: "NOT_A_PUBLIC_DRAFT" });

  const body = req.body as { signature?: string; accepted_at?: string } | undefined;
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  const acceptedAt = typeof body?.accepted_at === "string" ? body.accepted_at : null;

  if (!signature || !acceptedAt) {
    return badRequest(res, "Signature and accepted_at are required");
  }

  const ip = (req.ip || "").trim();
  const userAgent = (req.get("user-agent") || "").trim();

  await pool.query(
    `UPDATE bi_applications
        SET signed_at      = NOW(),
            signature_data = $2::jsonb,
            stage          = 'documents_pending'::bi_pipeline_stage,
            updated_at     = NOW()
      WHERE id = $1`,
    [id, JSON.stringify({ signature, accepted_at: acceptedAt, ip, user_agent: userAgent })]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     VALUES ($1, 'applicant', 'application_signed',
             'Public application signed by applicant', $2::jsonb)`,
    [id, JSON.stringify({ accepted_at: acceptedAt, ip })]
  );

  return ok(res, { success: true });
});

export default router;
