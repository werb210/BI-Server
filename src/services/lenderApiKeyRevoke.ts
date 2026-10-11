// BI_SERVER_v784_LENDER_KEY_REVOKE
// Shared by the staff route (/api/v1/bi/admin/lenders/:id/api-keys/:keyId/revoke)
// and the lender self-service route (/api/v1/lender/api-keys/:id/revoke).
// The WHERE clause always pins lender_id, so a caller can only ever touch
// keys that belong to the lender it names.
import { pool } from "../db";

export type LenderKeyRevokeResult = "revoked" | "already_revoked" | "not_found";

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number | null; rows: any[] }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeLenderApiKey(lenderId: string, keyId: string, db: Queryable = pool): Promise<LenderKeyRevokeResult> {
  if (!UUID_RE.test(String(keyId)) || !UUID_RE.test(String(lenderId))) return "not_found";
  const r = await db.query(
    `UPDATE bi_lender_api_keys
        SET is_active = FALSE, revoked_at = NOW()
      WHERE id = $1 AND lender_id = $2 AND is_active = TRUE
    RETURNING id`,
    [keyId, lenderId],
  );
  if ((r.rowCount ?? 0) > 0) return "revoked";
  const exists = await db.query(
    `SELECT id FROM bi_lender_api_keys WHERE id = $1 AND lender_id = $2 LIMIT 1`,
    [keyId, lenderId],
  );
  return (exists.rowCount ?? exists.rows.length) > 0 ? "already_revoked" : "not_found";
}
