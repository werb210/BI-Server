// BI_V1_FINAL_v47 — Authorization: Bearer pk_lender_<rand> auth for direct API.
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db";

export interface LenderApiAuthedRequest extends Request {
  lender?: { id: string; key_id: string };
}

export async function requireLenderApiKey(req: LenderApiAuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const m = /^Bearer\s+(pk_lender_[A-Za-z0-9_-]{16,})$/.exec(header);
  if (!m) return res.status(401).json({ ok: false, error: "MISSING_OR_INVALID_API_KEY" });
  const secret = m[1];
  const prefix = secret.slice(0, 12);
  const hash = createHash("sha256").update(secret).digest("hex");

  const r = await pool.query<{ id: string; lender_id: string }>(
    `SELECT id, lender_id FROM bi_lender_api_keys
      WHERE key_prefix = $1 AND key_hash = $2 AND is_active = TRUE
      LIMIT 1`,
    [prefix, hash]
  );
  if (!r.rows[0]) return res.status(401).json({ ok: false, error: "INVALID_API_KEY" });
  req.lender = { id: r.rows[0].lender_id, key_id: r.rows[0].id };
  return next();
}
