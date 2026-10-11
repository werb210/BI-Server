// BI_SERVER_BLOCK_v215_LENDER_APPLICATION_DETAIL_v1
import express, { type Request, type Response } from "express";
import { verifyBiToken } from "../platform/serviceTokens";
import { pool } from "../db";
import { ensureLenderActive, lenderContactIdFromClaims } from "../services/lenderActiveCache";

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// BI_SERVER_v789_LENDER_ACTIVE - lender id + login contact id from the JWT;
// the route then rejects a deactivated lender or contact.
function getLenderClaims(req: Request): { lenderId: string; contactId: string | null } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const payload = verifyBiToken(m[1].trim(), secret) as any;
  if (!payload || payload.kind !== "lender" || !payload.id) return null;
  return { lenderId: String(payload.id), contactId: lenderContactIdFromClaims(payload) };
}

function stageOf(status?: string | null): string {
  if (!status) return "submitted";
  const s = status.toLowerCase();
  if (["new_application", "submitted"].includes(s)) return "submitted";
  if (["underwriting", "in_review"].includes(s)) return "underwriting";
  if (["conditional_approval", "conditional"].includes(s)) return "conditional";
  if (["bound", "approved", "issued"].includes(s)) return "bound";
  if (["declined", "withdrawn", "cancelled"].includes(s)) return "declined";
  return "submitted";
}

router.get("/api/v1/lender/applications/:code", async (req: Request, res: Response) => {
  const claims = getLenderClaims(req);
  if (!claims) return res.status(401).json({ error: "unauthorized" });
  if (!(await ensureLenderActive(req, res, claims.lenderId, claims.contactId))) return;
  const lenderId = claims.lenderId;

  const code = String(req.params.code || "").trim();
  if (!code) return res.status(400).json({ error: "missing_code" });

  const isUuid = UUID_RE.test(code);
  const sql = isUuid
    ? `SELECT * FROM bi_applications WHERE id = $1 AND lender_id = $2 LIMIT 1`
    : `SELECT * FROM bi_applications WHERE application_code = $1 AND lender_id = $2 LIMIT 1`;
  const result = await pool.query(sql, [code, lenderId]);
  if (result.rows.length === 0) return res.status(404).json({ error: "not_found" });

  const app = result.rows[0];

  // BI_SERVER_BLOCK_v275_LENDER_DETAIL_DOCUMENTS_v1
  // Real documents query — replaces the v215 stub. Excludes purged
  // rows. Returns the fields the lender portal already renders plus
  // the metadata a future "open document" link will need (blob_url
  // for direct download, doc_type / mime_type / bytes for display).
  const docsResult = await pool.query(
    `SELECT id, doc_type, document_type, original_filename, mime_type,
            bytes, blob_url, uploaded_by_actor, created_at
       FROM bi_documents
      WHERE application_id = $1
        AND purged_at IS NULL
      ORDER BY created_at DESC`,
    [app.id]
  );

  return res.json({
    id: app.id,
    application_code: app.application_code,
    company_name: app.company_name,
    guarantor_name: app.guarantor_name,
    guarantor_phone: app.guarantor_phone,
    guarantor_email: app.guarantor_email,
    status: app.status,
    stage: stageOf(app.status),
    source: app.source,
    core_inputs: app.core_inputs,
    consents: app.consents,
    lender_notes: app.lender_notes,
    created_at: app.created_at,
    updated_at: app.updated_at,
    documents: docsResult.rows,
  });
});

export default router;
