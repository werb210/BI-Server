// BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1
// POST /api/v1/bi/applications/:public_id/documents/from-bf
// Service-JWT-authed (kind=service, source=bf-server). Inserts a
// bi_documents row tagged with source='bf_mirror' plus the BF
// provenance ids. Idempotent: if bf_document_id already exists
// for this BI application, returns the existing row.
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";

const router = express.Router();

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}

function verifyServiceJwt(req: Request): { source: string } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; source?: string };
    if (p?.kind !== "service" || !p?.source) return null;
    return { source: String(p.source) };
  } catch {
    return null;
  }
}

function s(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

router.post("/applications/:public_id/documents/from-bf", async (req: Request, res: Response) => {
  const svc = verifyServiceJwt(req);
  if (!svc) return res.status(401).json({ ok: false, error: "service_jwt_required" });
  if (svc.source !== "bf-server") {
    return res.status(403).json({ ok: false, error: "service_source_not_allowed" });
  }

  const publicId = s(req.params.public_id);
  if (!publicId) return res.status(400).json({ ok: false, error: "public_id_required" });

  // BI_SERVER_BLOCK_v269_DOC_MIRROR_COLUMN_FIX_v1
  // Parse the BF payload against the live bi_documents schema (master
  // schema 20260222 + 20260428 blob_storage + v249 bf_provenance).
  // We do NOT have a column for uploaded_by_name today; if BF needs
  // its uploader name preserved a follow-up migration can add one.
  const b: any = req.body ?? {};
  const bfDocumentId = s(b.bf_document_id);
  const bfApplicationId = s(b.bf_application_id);
  const bfDocumentTypeRaw = s(b.document_type) ?? "other";
  const originalFilename = s(b.file_name) ?? "document";
  const mimeType = s(b.mime_type) ?? "application/octet-stream";
  const bytes = typeof b.file_size === "number" && Number.isFinite(b.file_size) ? b.file_size : null;
  const blobUrl = s(b.storage_url);

  // Best-effort mapping from BF's free-form document_type strings to
  // bi_document_type ENUM. Fallback is 'enforcement_notice' because the
  // ENUM has no generic "other" value and that bucket is least loaded
  // for downstream filters. The original BF string is preserved in the
  // document_type TEXT mirror column.
  const BF_TO_BI_DOC_TYPE: Record<string, string> = {
    loan_agreement: "loan_agreement_signed",
    loan_agreement_signed: "loan_agreement_signed",
    personal_guarantee: "personal_guarantee_copy",
    personal_guarantee_copy: "personal_guarantee_copy",
    financial_statement: "financial_statements",
    financial_statements: "financial_statements",
    bank_statement: "financial_statements",
    tax_return: "financial_statements",
    pl_12mo: "financial_statements",
    forecast: "financial_statements",
    annual_y1: "financial_statements",
    annual_y2: "financial_statements",
    annual_y3: "financial_statements",
    proof_of_id: "proof_of_id",
    id_verification: "id_verification",
    drivers_license: "proof_of_id",
    passport: "proof_of_id",
    gov_id_primary: "proof_of_id",
    gov_id_secondary: "proof_of_id",
    corporate_registration: "corporate_registration_docs",
    corporate_registration_docs: "corporate_registration_docs",
    articles_of_incorporation: "corporate_registration_docs",
    enforcement_notice: "enforcement_notice",
  };
  const docTypeEnum = BF_TO_BI_DOC_TYPE[bfDocumentTypeRaw.toLowerCase()] ?? "enforcement_notice";

  if (!bfDocumentId) {
    return res.status(400).json({ ok: false, error: "bf_document_id_required" });
  }

  // Resolve BI application by public_id.
  const appRow = await pool.query<{ id: string }>(
    `SELECT id FROM bi_applications WHERE public_id = $1 LIMIT 1`,
    [publicId],
  );
  if (!appRow.rows[0]) {
    return res.status(404).json({ ok: false, error: "bi_application_not_found" });
  }
  const biApplicationId = appRow.rows[0].id;

  // Idempotency: if we've already mirrored this BF document to
  // this BI app, return the existing row.
  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM bi_documents
        WHERE bf_document_id = $1 AND application_id::text = $2
        LIMIT 1`,
      [bfDocumentId, biApplicationId],
    );
    if (existing.rows[0]) {
      return res.json({
        ok: true,
        idempotent: true,
        bi_document_id: existing.rows[0].id,
      });
    }
  } catch (e) {
    logger.error({ err: e, bfDocumentId, biApplicationId }, "docs_from_bf_idempotency_lookup_failed");
  }

  const id = randomUUID();
  try {
    // BI_SERVER_BLOCK_v269_DOC_MIRROR_COLUMN_FIX_v1
    // Real columns per master schema + 20260428_bi_blob_storage + v249:
    //   id, application_id, doc_type (NOT NULL enum), original_filename,
    //   mime_type, bytes, blob_url, uploaded_by_actor (NOT NULL enum),
    //   document_type (TEXT, BF's original string), source, bf_document_id,
    //   bf_application_id, created_at.
    // No updated_at column on bi_documents. No uploaded_by_name column.
    await pool.query(
      `INSERT INTO bi_documents
         (id, application_id, doc_type, original_filename, mime_type, bytes,
          blob_url, uploaded_by_actor,
          document_type, source, bf_document_id, bf_application_id,
          created_at)
       VALUES ($1,$2,$3::bi_document_type,$4,$5,$6,$7,'system'::bi_actor_type,
               $8,'bf_mirror',$9,$10,NOW())`,
      [
        id, biApplicationId, docTypeEnum, originalFilename, mimeType, bytes,
        blobUrl,
        bfDocumentTypeRaw,
        bfDocumentId, bfApplicationId,
      ],
    );
  } catch (e: any) {
    logger.error({ err: e, bfDocumentId, biApplicationId }, "docs_from_bf_insert_failed");
    return res.status(500).json({ ok: false, error: "insert_failed", detail: e?.message });
  }

  return res.json({
    ok: true,
    bi_document_id: id,
    bi_application_id: biApplicationId,
  });
});

export default router;
