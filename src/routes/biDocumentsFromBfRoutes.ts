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

  const b: any = req.body ?? {};
  const bfDocumentId = s(b.bf_document_id);
  const bfApplicationId = s(b.bf_application_id);
  const documentType = s(b.document_type) ?? "other";
  const fileName = s(b.file_name) ?? "document";
  const mimeType = s(b.mime_type) ?? "application/octet-stream";
  const fileSize = typeof b.file_size === "number" && Number.isFinite(b.file_size) ? b.file_size : null;
  const storageUrl = s(b.storage_url);
  const uploadedByName = s(b.uploaded_by_name);

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
    await pool.query(
      `INSERT INTO bi_documents
         (id, application_id, document_type, file_name, mime_type, file_size,
          storage_url, uploaded_by_name,
          source, bf_document_id, bf_application_id,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'bf_mirror',$9,$10,NOW(),NOW())`,
      [
        id, biApplicationId, documentType, fileName, mimeType, fileSize,
        storageUrl, uploadedByName,
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
