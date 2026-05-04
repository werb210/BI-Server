// BI_PGI_ALIGNMENT_v56 — staff CRUD for lenders.
import { Router } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { mirrorToContact } from "../services/crmMirrorService";
import { logger } from "../platform/logger";
import crypto from "node:crypto";
const router = Router(); const COUNTRY_RE = /^(CA|US)$/;
router.get("/admin/lenders", async (_req, res) => { const r = await pool.query(`SELECT id, company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active, created_at FROM bi_lenders ORDER BY company_name`); return ok(res, { lenders: r.rows }); });
router.post("/admin/lenders", async (req, res) => { const b = (req.body ?? {}) as Record<string, unknown>; const company_name = String(b.company_name ?? "").trim(); const contact_full_name = String(b.contact_full_name ?? "").trim(); const contact_email = String(b.contact_email ?? "").trim().toLowerCase(); const contact_phone_e164 = String(b.contact_phone_e164 ?? "").trim(); const country = String(b.country ?? "CA").toUpperCase(); if (!company_name) return badRequest(res, "company_name required"); if (!contact_full_name) return badRequest(res, "contact_full_name required"); if (!contact_email) return badRequest(res, "contact_email required"); if (!contact_phone_e164) return badRequest(res, "contact_phone_e164 required"); if (!COUNTRY_RE.test(country)) return badRequest(res, "country must be CA or US"); try { const r = await pool.query<{ id: string }>(`INSERT INTO bi_lenders (company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING id`, [company_name,(b.website_url as string) || null,(b.address_line1 as string) || null,(b.city as string) || null,(b.province as string) || null,(b.postal_code as string) || null,country,contact_full_name, contact_email, contact_phone_e164]); const lender_id = r.rows[0]!.id; await mirrorToContact({ source: "lender_contact", full_name: contact_full_name, email: contact_email, phone_e164: contact_phone_e164, company_name, extra_tags: [`lender:${lender_id}`] }); return ok(res, { id: lender_id }); } catch (err) { logger.error({ err }, "create lender failed"); return badRequest(res, "create failed"); } });
router.patch("/admin/lenders/:id", async (req, res) => { const id = req.params.id; const b = (req.body ?? {}) as Record<string, unknown>; if (b.country !== undefined && !COUNTRY_RE.test(String(b.country).toUpperCase())) return badRequest(res, "country must be CA or US"); const setSql: string[] = []; const vals: unknown[] = [id]; let i = 2; const cols = ["company_name","website_url","address_line1","city","province","postal_code","country","contact_full_name","contact_email","contact_phone_e164","is_active"]; for (const c of cols) { if (b[c] !== undefined) { setSql.push(`${c} = $${i++}`); vals.push(c === "country" ? String(b[c]).toUpperCase() : b[c]); }} if (!setSql.length) return badRequest(res, "no fields to update"); await pool.query(`UPDATE bi_lenders SET ${setSql.join(", ")} WHERE id = $1`, vals); return ok(res, { updated: true }); });
router.delete("/admin/lenders/:id", async (req, res) => { await pool.query(`UPDATE bi_lenders SET is_active = FALSE WHERE id = $1`, [req.params.id]); return ok(res, { deactivated: true }); });
// BI_SERVER_BLOCK_v65_LENDER_API_KEY_MINT_v1 — staff mints/lists/revokes
// API keys for a given BI-lender. Secret is shown ONCE on creation, hashed
// at rest. Bearer auth on biLenderApiRoutes verifies via key_hash.
router.get("/admin/lenders/:id/api-keys", async (req, res) => {
  const r = await pool.query(
    `SELECT id, key_hash, active, last_used_at, created_at
       FROM bi_lender_api_keys
      WHERE lender_id = $1
      ORDER BY created_at DESC`,
    [req.params.id]
  );
  const items = r.rows.map((row: any) => ({
    id: row.id,
    prefix: typeof row.key_hash === "string" ? row.key_hash.slice(0, 8) : "",
    active: row.active,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  }));
  return ok(res, { items });
});

router.post("/admin/lenders/:id/api-keys", async (req, res) => {
  const lenderId = req.params.id;
  const exists = await pool.query(`SELECT id FROM bi_lenders WHERE id = $1`, [lenderId]);
  if (exists.rowCount === 0) return badRequest(res, "lender not found");

  const prefix = "bk_" + crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(24).toString("hex");
  const wire = `${prefix}.${secret}`;
  const hash = crypto.createHash("sha256").update(wire).digest("hex");

  const r = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO bi_lender_api_keys (lender_id, key_hash, active)
     VALUES ($1, $2, TRUE)
     RETURNING id, created_at`,
    [lenderId, hash]
  );
  return ok(res, {
    id: r.rows[0]!.id,
    created_at: r.rows[0]!.created_at,
    secret: wire,
    note: "Copy this key now. It cannot be retrieved later.",
  });
});

router.post("/admin/lenders/:id/api-keys/:keyId/revoke", async (req, res) => {
  await pool.query(
    `UPDATE bi_lender_api_keys SET active = FALSE
       WHERE id = $1 AND lender_id = $2`,
    [req.params.keyId, req.params.id]
  );
  return ok(res, { revoked: true });
});

export default router;
