// BI_V1_FINAL_v47 — Lender direct API (V1 BI item 10).
// Auth: Authorization: Bearer pk_lender_*. POST application + base64 docs.
import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";
import { requireAuth } from "../platform/auth";
import { requireLenderApiKey, type LenderApiAuthedRequest } from "../middleware/lenderApiKey";
import { getStorage } from "../lib/storage";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";

const router = Router();

router.post("/admin/lenders/:lenderId/api-keys", requireAuth, async (req, res) => {
  const lenderId = String(req.params.lenderId ?? "").trim();
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : null;
  if (!lenderId) return badRequest(res, "lenderId required");
  const lender = await pool.query("SELECT id FROM bi_lenders WHERE id=$1 LIMIT 1", [lenderId]);
  if (!lender.rows[0]) return badRequest(res, "Lender not found");
  const secret = `pk_lender_${randomBytes(24).toString("base64url")}`;
  const prefix = secret.slice(0, 12);
  const hash = createHash("sha256").update(secret).digest("hex");
  const r = await pool.query<{ id: string }>(
    `INSERT INTO bi_lender_api_keys (lender_id, key_prefix, key_hash, label)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [lenderId, prefix, hash, label]
  );
  return ok(res, { ok: true, key_id: r.rows[0].id, secret, key_prefix: prefix, label });
});

router.post("/admin/lenders/api-keys/:keyId/revoke", requireAuth, async (req, res) => {
  const keyId = String(req.params.keyId ?? "").trim();
  if (!keyId) return badRequest(res, "keyId required");
  const r = await pool.query(
    `UPDATE bi_lender_api_keys SET is_active=FALSE, revoked_at=NOW() WHERE id=$1 RETURNING id`,
    [keyId]
  );
  if (!r.rows[0]) return badRequest(res, "Key not found");
  return ok(res, { ok: true, key_id: keyId });
});

router.post(
  "/lender-api/applications",
  requireLenderApiKey,
  async (req: LenderApiAuthedRequest, res) => {
    const lenderId = req.lender?.id;
    if (!lenderId) return badRequest(res, "Lender context missing");

    const application = (req.body?.application ?? {}) as Record<string, unknown>;
    const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (!application || typeof application !== "object") {
      return badRequest(res, "application object required");
    }

    const data = JSON.stringify(application);
    const appInsert = await pool.query<{ id: string }>(
      `INSERT INTO bi_applications (data, created_by_lender_id, stage)
       VALUES ($1::jsonb, $2, 'new_application'::bi_pipeline_stage)
       RETURNING id`,
      [data, lenderId]
    );
    const appId = appInsert.rows[0].id;

    const store = getStorage();
    const created: { id: string; doc_type: string }[] = [];

    for (const doc of documents) {
      const docType = String((doc as { doc_type?: string })?.doc_type ?? "other").trim() || "other";
      const filename = String((doc as { filename?: string })?.filename ?? `lender-doc-${created.length + 1}`).trim();
      const contentType = String((doc as { content_type?: string })?.content_type ?? "application/octet-stream").trim();
      const b64 = String((doc as { base64?: string })?.base64 ?? "");
      if (!b64) continue;
      const buf = Buffer.from(b64, "base64");
      const put = await store.put({
        buffer: buf,
        filename,
        contentType,
        pathPrefix: `applications/${appId}`,
      });
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO bi_documents
           (application_id, doc_type, original_filename, storage_key, blob_name, blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'lender')
         RETURNING id`,
        [appId, docType, filename, put.blobName, put.blobName, put.url, put.hash, contentType, put.sizeBytes]
      );
      created.push({ id: ins.rows[0].id, doc_type: docType });
    }

    await pool.query(
      `INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta)
       VALUES ($1, 'lender', 'lender_api_submission', $2, $3::jsonb)`,
      [appId, "Application submitted via lender direct API", JSON.stringify({ lender_id: lenderId, document_count: created.length })]
    ).catch(() => undefined);

    let pgiResult: { externalId: string; status: string; alreadySubmitted: boolean } | null = null;
    try {
      pgiResult = await submitApplicationToPGI(appId);
    } catch {
      pgiResult = null;
    }

    return ok(res, { ok: true, application_id: appId, documents: created, pgi: pgiResult });
  }
);

export default router;
