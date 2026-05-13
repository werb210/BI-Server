// BI_PGI_ALIGNMENT_v56 — staff CRUD for lenders.
import { Router } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { mirrorToContact } from "../services/crmMirrorService";
import { logger } from "../platform/logger";
import crypto from "node:crypto";
// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1
import twilio from "twilio";
const router = Router(); const COUNTRY_RE = /^(CA|US)$/;

// BI_SERVER_BLOCK_v183_ADMIN_LENDER_ROLE_GATE_v1
// All routes in this file are admin-only. Mount-level requireAuth
// only verifies token validity; it does not check role. Without
// this gate any authenticated user (lender, referrer, fresh OTP)
// could mint API keys for other lenders. Inline gate so we don't
// need to touch the auth.ts module exports.
router.use((req: any, res: any, next: any) => {
  const role = String((req.user as { role?: string } | undefined)?.role ?? "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ status: "error", error: "ADMIN_ONLY" });
  }
  next();
});

// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 — fire-and-forget SMS to a single number.
async function sendBiSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !tok || !from) {
    logger.warn({ to }, "[v235] Twilio not configured — SMS skipped");
    return;
  }
  try {
    const client = twilio(sid, tok);
    await client.messages.create({ from, to, body });
  } catch (err) {
    logger.error({ err, to }, "[v235] SMS send failed");
  }
}

// BI_SERVER_BLOCK_v237_REVOKE_KEYS_ON_DEACTIVATE_v1 — revoke all active API keys for a lender.
// Returns the count actually flipped so callers can echo it.
async function revokeLenderKeys(lenderId: string): Promise<number> {
  const r = await pool.query<{ id: string }>(
    `UPDATE bi_lender_api_keys
        SET is_active = FALSE, revoked_at = NOW()
      WHERE lender_id = $1 AND is_active = TRUE
      RETURNING id`,
    [lenderId],
  );
  if (r.rowCount && r.rowCount > 0) {
    await pool.query(
      `INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta)
       VALUES (NULL, 'staff', 'lender_keys_bulk_revoked', $1, $2::jsonb)`,
      [
        `Auto-revoked ${r.rowCount} API key(s) for lender ${lenderId} on deactivation`,
        JSON.stringify({ lender_id: lenderId, revoked_key_ids: r.rows.map((x) => x.id) }),
      ],
    ).catch(() => {});
  }
  return r.rowCount ?? 0;
}


router.get("/admin/lenders", async (_req, res) => { const r = await pool.query(`SELECT id, company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active, created_at FROM bi_lenders ORDER BY company_name`); return ok(res, { lenders: r.rows }); });
router.post("/admin/lenders", async (req, res) => { const b = (req.body ?? {}) as Record<string, unknown>; const company_name = String(b.company_name ?? "").trim(); const contact_full_name = String(b.contact_full_name ?? "").trim(); const contact_email = String(b.contact_email ?? "").trim().toLowerCase(); const contact_phone_e164 = String(b.contact_phone_e164 ?? "").trim(); const country = String(b.country ?? "CA").toUpperCase(); if (!company_name) return badRequest(res, "company_name required"); if (!contact_full_name) return badRequest(res, "contact_full_name required"); if (!contact_email) return badRequest(res, "contact_email required"); if (!contact_phone_e164) return badRequest(res, "contact_phone_e164 required"); if (!COUNTRY_RE.test(country)) return badRequest(res, "country must be CA or US"); try { const r = await pool.query<{ id: string }>(`INSERT INTO bi_lenders (company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING id`, [company_name,(b.website_url as string) || null,(b.address_line1 as string) || null,(b.city as string) || null,(b.province as string) || null,(b.postal_code as string) || null,country,contact_full_name, contact_email, contact_phone_e164]); const lender_id = r.rows[0]!.id; await mirrorToContact({ source: "lender_contact", full_name: contact_full_name, email: contact_email, phone_e164: contact_phone_e164, company_name, extra_tags: [`lender:${lender_id}`] }); /* BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 */ void sendBiSms(contact_phone_e164, `Boreal Risk: ${contact_full_name}, you have been added as a lender. Sign in to the lender portal: https://www.boreal.insure/lender/login. Use this mobile number when prompted. Reply STOP to opt out.`); return ok(res, { id: lender_id }); } catch (err) { logger.error({ err }, "create lender failed"); return badRequest(res, "create failed"); } });
router.patch("/admin/lenders/:id", async (req, res) => { const id = req.params.id; const b = (req.body ?? {}) as Record<string, unknown>; if (b.country !== undefined && !COUNTRY_RE.test(String(b.country).toUpperCase())) return badRequest(res, "country must be CA or US"); const setSql: string[] = []; const vals: unknown[] = [id]; let i = 2; const cols = ["company_name","website_url","address_line1","city","province","postal_code","country","contact_full_name","contact_email","contact_phone_e164","is_active"]; for (const c of cols) { if (b[c] !== undefined) { setSql.push(`${c} = $${i++}`); vals.push(c === "country" ? String(b[c]).toUpperCase() : b[c]); }} if (!setSql.length) return badRequest(res, "no fields to update"); await pool.query(`UPDATE bi_lenders SET ${setSql.join(", ")} WHERE id = $1`, vals); /* BI_SERVER_BLOCK_v237_REVOKE_KEYS_ON_DEACTIVATE_v1 */ let _keysRevoked = 0; if (b.is_active === false) { _keysRevoked = await revokeLenderKeys(id); } return ok(res, { updated: true, keys_revoked: _keysRevoked }); });
/* BI_SERVER_BLOCK_v237_REVOKE_KEYS_ON_DEACTIVATE_v1 — atomically revoke API keys on lender deactivation */
router.delete("/admin/lenders/:id", async (req, res) => {
  const id = req.params.id;
  await pool.query(`UPDATE bi_lenders SET is_active = FALSE WHERE id = $1`, [id]);
  const revoked = await revokeLenderKeys(id);
  return ok(res, { deactivated: true, keys_revoked: revoked });
});
// BI_SERVER_BLOCK_v65_LENDER_API_KEY_MINT_v1 — staff mints/lists/revokes
// API keys for a given BI-lender. Secret is shown ONCE on creation, hashed
// at rest. Bearer auth on biLenderApiRoutes verifies via key_hash.
router.get("/admin/lenders/:id/api-keys", async (req, res) => {
  const r = await pool.query(
    `SELECT id, key_hash, key_prefix, is_active, last_used_at, created_at
       FROM bi_lender_api_keys
      WHERE lender_id = $1
      ORDER BY created_at DESC`,
    [req.params.id]
  );
  const items = r.rows.map((row: any) => ({
    id: row.id,
    prefix: typeof row.key_hash === "string" ? row.key_hash.slice(0, 8) : "",
    is_active: row.is_active,  // BI_SERVER_BLOCK_v245_LIVE_TEST_FIXES_PT2_v1
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
    `INSERT INTO bi_lender_api_keys (lender_id, key_hash, key_prefix, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, created_at`,
    [lenderId, hash, prefix]
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


// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 — staff toggles live-key minting for a lender
// and notifies the lender via SMS.
router.post("/admin/lenders/:id/approve-live-keys", async (req, res) => {
  const id = req.params.id;
  const enabled = req.body?.enabled !== false; // default TRUE
  const r = await pool.query<{ contact_phone_e164: string | null; contact_full_name: string | null; company_name: string }>(
    `UPDATE bi_lenders SET live_keys_enabled = $1 WHERE id = $2
     RETURNING contact_phone_e164, contact_full_name, company_name`,
    [enabled, id],
  );
  if (!r.rows[0]) return badRequest(res, "lender not found");
  const row = r.rows[0];
  if (enabled && row.contact_phone_e164) {
    void sendBiSms(
      row.contact_phone_e164,
      `Boreal Risk: ${row.contact_full_name || "your lender account"} has been approved for LIVE API keys. ` +
      `Generate one at https://boreal.financial/lender/sandbox. Reply STOP to opt out.`,
    );
  }
  await pool.query(
    `INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta)
     VALUES (NULL, 'staff', $1, $2, $3::jsonb)`,
    [enabled ? "lender_live_approved" : "lender_live_revoked",
     `Live keys ${enabled ? "approved" : "revoked"} for ${row.company_name}`,
     JSON.stringify({ lender_id: id, enabled })],
  ).catch(() => {});
  return ok(res, { id, live_keys_enabled: enabled });
});



// BI_SERVER_BLOCK_v243_LENDER_USERS_v1
router.get("/admin/lenders/:id/contacts", async (req, res) => {
  const r = await pool.query(`SELECT id, lender_id, full_name, email, phone_e164, role, is_primary, is_active, last_login_at, created_at, updated_at FROM bi_lender_contacts WHERE lender_id = $1 ORDER BY is_primary DESC, created_at DESC`, [req.params.id]);
  return ok(res, { contacts: r.rows });
});

router.post("/admin/lenders/:id/contacts", async (req, res) => {
  const lender_id = req.params.id; const b:any = req.body ?? {};
  const full_name = String(b.full_name ?? "").trim(); const email = String(b.email ?? "").trim().toLowerCase(); const phone_e164 = String(b.phone_e164 ?? "").trim();
  const role = String(b.role ?? "").trim() || null; const is_primary = b.is_primary === true;
  if (!full_name) return badRequest(res, "full_name required"); if (!phone_e164) return badRequest(res, "phone_e164 required");
  const lr = await pool.query(`SELECT company_name FROM bi_lenders WHERE id=$1 LIMIT 1`, [lender_id]); if (!lr.rows[0]) return res.status(404).json({ error: "lender_not_found" });
  let contact_id: string;
  try { const r = await pool.query(`INSERT INTO bi_lender_contacts (lender_id, full_name, email, phone_e164, role, is_primary, is_active) VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`, [lender_id, full_name, email || null, phone_e164, role, is_primary]); contact_id = r.rows[0].id; }
  catch (err:any) { if (err?.code === '23505') return res.status(409).json({ error: 'phone_already_in_use' }); throw err; }
  await mirrorToContact({ source: 'lender_contact', full_name, email: email || undefined, phone_e164, company_name: lr.rows[0].company_name, lifecycle_stage: 'partner', extra_tags: [`lender:${lender_id}`, `lender_contact:${contact_id}`], }).catch(() => {});
  void sendBiSms(phone_e164, `Boreal Risk: Hi ${full_name.split(/\s+/)[0]}, you've been added as a contact for ${lr.rows[0].company_name}. Sign in to submit applications: https://www.boreal.insure/lender/login. Use this number when prompted. Reply STOP to opt out.`);
  return ok(res, { id: contact_id });
});

export default router;
