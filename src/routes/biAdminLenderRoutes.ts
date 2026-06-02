// BI_PGI_ALIGNMENT_v56 — staff CRUD for lenders.
import { Router } from "express";
// BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1 — manual Apollo sync trigger.
import { runContactSyncOnce } from "../jobs/apolloSyncJob";
// BI_SERVER_BLOCK_73_APOLLO_LIST_FORK_v1 - added searchPeople (mixed_people) and searchCompaniesByLabel (mixed_companies).
import { listEmailAccounts as _apolloListEmailAccounts, listLabels as _apolloListLabels, searchContacts as _apolloSearchContactsByLabel, searchPeople as _apolloSearchPeopleByLabel, searchCompaniesByLabel as _apolloSearchCompaniesByLabel } from "../integrations/apollo/apolloClient";
import { upsertApolloContact as _apolloUpsertByLabel } from "../integrations/apollo/apolloContactSync";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { mirrorToContact } from "../services/crmMirrorService";
import { logger } from "../platform/logger";
import { normalizeE164 } from "../util/phoneE164"; // BI_SERVER_BLOCK_v414_LENDER_LOGIN_PROVISION_v1
import crypto from "node:crypto";
// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1
import twilio from "twilio";
const router = Router(); const COUNTRY_RE = /^(CA|US)$/;

function getApolloErrorMessage(err: unknown): string {
  const fallback = err instanceof Error ? err.message : String(err);
  const e = err as { body?: unknown };
  if (!e || typeof e !== "object") return fallback;
  const body = e.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return fallback;
  const msg = body.message ?? body.error ?? body.errors;
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join("; ");
  if (msg && typeof msg === "object") return JSON.stringify(msg);
  return fallback;
}

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

// BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 — single-number SMS.
// BI_SERVER_BLOCK_v412_LENDER_SMS_NORMALIZE_AND_PURGE_v1 — normalize the destination to
// bare E.164 (stored numbers like "+1 (587) 581-5330" were rejected by Twilio) and
// return a real result instead of swallowing it, so the portal can show sent/failed.
type BiSmsResult = { sent: boolean; skipped?: boolean; error?: string; to: string };
function toE164(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}
async function sendBiSms(to: string, body: string): Promise<BiSmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const e164 = toE164(to);
  if (!sid || !tok || !from) {
    logger.warn({ to }, "[v235] Twilio not configured — SMS skipped");
    return { sent: false, skipped: true, error: "twilio_not_configured", to: e164 ?? to };
  }
  if (!e164) {
    logger.error({ to }, "[v412] invalid phone — SMS skipped");
    return { sent: false, error: "invalid_phone", to };
  }
  try {
    const client = twilio(sid, tok);
    const msg = await client.messages.create({ from, to: e164, body });
    logger.info({ to: e164, sid: msg.sid }, "[v412] SMS sent");
    return { sent: true, to: e164 };
  } catch (err: any) {
    logger.error({ err, to: e164 }, "[v235] SMS send failed");
    return { sent: false, error: err?.message ? String(err.message) : "send_failed", to: e164 };
  }
}

// BI_SERVER_BLOCK_v414_LENDER_LOGIN_PROVISION_v1 — staff-created lenders/contacts must
// also land in bi_lender_login_contacts (the table the lender-login OTP checks) or they
// can never sign in. Idempotent: skips if an active login row already matches.
async function provisionLoginContact(lenderId: string, opts: { phone?: string | null; email?: string | null; full_name?: string | null; role?: string | null }): Promise<void> {
  const phone = opts.phone ? normalizeE164(opts.phone) : null;
  const email = opts.email && opts.email.trim() ? opts.email.trim().toLowerCase() : null;
  if (!phone && !email) return;
  try {
    await pool.query(
      `INSERT INTO bi_lender_login_contacts (lender_id, email, phone_e164, full_name, role, is_active)
       SELECT $1, $2, $3, $4, $5, TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM bi_lender_login_contacts lc
           WHERE lc.lender_id = $1 AND lc.is_active = TRUE
             AND ( ($3::text IS NOT NULL AND lc.phone_e164 = $3)
                OR ($2::text IS NOT NULL AND LOWER(lc.email) = $2) ) )`,
      [lenderId, email, phone, opts.full_name ?? null, opts.role ?? null],
    );
  } catch (err) {
    logger.error({ err, lenderId }, "[v414] provisionLoginContact failed");
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


router.get("/admin/lenders", async (req, res) => { const inc = String(req.query?.include_inactive ?? "").toLowerCase(); const includeInactive = inc === "true" || inc === "1"; const where = includeInactive ? "" : "WHERE is_active = TRUE"; const r = await pool.query(`SELECT id, company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active, created_at FROM bi_lenders ${where} ORDER BY company_name`); return ok(res, { lenders: r.rows }); });

// BI_SERVER_BLOCK_v247_BI_API_FIXES_v1 -- staff portal lists referrers from
// the Referrer page in the BI silo. Route was missing -> 404. The master
// schema bi_referrers shape has company_name/full_name/phone_e164, while
// the pgi_alignment migration adds first_name/last_name/phone columns;
// SELECT * is the safest projection here since both shapes exist in the
// wild. Frontend tolerates either field set.
router.get("/admin/referrers", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM bi_referrers ORDER BY created_at DESC NULLS LAST LIMIT 500`,
    );
    return ok(res, { referrers: r.rows });
  } catch (err) {
    logger.error({ err }, "list referrers failed");
    return ok(res, { referrers: [] });
  }
});

// BI_SERVER_BLOCK_BI_ADMIN_REFERRER_DETAIL_v1
// Staff portal drills into a referrer to see the four related sets the
// detail panel expects: the referrer row itself, the referrals they
// generated, the BI applications matched to them, and the commission
// ledger entries. Shape mirrors BIReferrerManagement.tsx Detail type.
// Unknown ids return 404 so the portal can render an empty state
// instead of a generic API_ERROR. All queries are read-only and
// capped at 500 rows.
router.get("/admin/referrers/:id/detail", async (req, res) => {
  const id = req.params.id;
  try {
    const refRow = await pool.query(`SELECT * FROM bi_referrers WHERE id = $1 LIMIT 1`, [id]);
    if (refRow.rowCount === 0) {
      return res.status(404).json({ status: "error", error: "REFERRER_NOT_FOUND" });
    }
    const referrals = await pool.query(
      `SELECT id, full_name, company_name, email, phone_e164, ref_code, sms_sent_at,
              application_id, application_created, matched_at, status, created_at
         FROM bi_referrals
        WHERE referrer_id = $1
        ORDER BY created_at DESC NULLS LAST
        LIMIT 500`,
      [id],
    );
    const applications = await pool.query(
      `SELECT a.id, a.application_code,
              COALESCE(a.business_name, a.company_name) AS business_name,
              a.stage, a.status, a.annual_premium, a.policy_id, a.updated_at
         FROM bi_applications a
        WHERE a.referrer_id = $1
        ORDER BY a.updated_at DESC NULLS LAST
        LIMIT 500`,
      [id],
    );
    const commissions = await pool.query(
      `SELECT c.id, c.amount, c.status, c.accrued_at, c.payable_at, c.paid_at,
              c.application_id,
              COALESCE(a.business_name, a.company_name) AS business_name
         FROM bi_referrer_commissions c
         LEFT JOIN bi_applications a ON a.id = c.application_id
        WHERE c.referrer_id = $1
        ORDER BY c.accrued_at DESC NULLS LAST
        LIMIT 500`,
      [id],
    );
    return ok(res, {
      detail: {
        referrer: refRow.rows[0],
        referrals: referrals.rows,
        applications: applications.rows,
        commissions: commissions.rows,
      },
    });
  } catch (err) {
    logger.error({ err, id }, "referrer detail failed");
    return res.status(500).json({ status: "error", error: "REFERRER_DETAIL_FAILED" });
  }
});
router.post("/admin/lenders", async (req, res) => { const b = (req.body ?? {}) as Record<string, unknown>; const company_name = String(b.company_name ?? "").trim(); const contact_full_name = String(b.contact_full_name ?? "").trim(); const contact_email = String(b.contact_email ?? "").trim().toLowerCase(); const contact_phone_e164 = String(b.contact_phone_e164 ?? "").trim(); const country = String(b.country ?? "CA").toUpperCase(); if (!company_name) return badRequest(res, "company_name required"); if (!contact_full_name) return badRequest(res, "contact_full_name required"); if (!contact_email) return badRequest(res, "contact_email required"); if (!contact_phone_e164) return badRequest(res, "contact_phone_e164 required"); if (!COUNTRY_RE.test(country)) return badRequest(res, "country must be CA or US"); try { const r = await pool.query<{ id: string }>(`INSERT INTO bi_lenders (company_name, website_url, address_line1, city, province, postal_code, country, contact_full_name, contact_email, contact_phone_e164, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING id`, [company_name,(b.website_url as string) || null,(b.address_line1 as string) || null,(b.city as string) || null,(b.province as string) || null,(b.postal_code as string) || null,country,contact_full_name, contact_email, contact_phone_e164]); const lender_id = r.rows[0]!.id; await mirrorToContact({ source: "lender_contact", full_name: contact_full_name, email: contact_email, phone_e164: contact_phone_e164, company_name, extra_tags: [`lender:${lender_id}`] }); await provisionLoginContact(lender_id, { phone: contact_phone_e164, email: contact_email, full_name: contact_full_name, role: "primary" }); /* BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1 */ const _sms = await sendBiSms(contact_phone_e164, `Boreal Risk: ${contact_full_name}, you have been added as a lender. Sign in to the lender portal: https://www.boreal.insure/lender/login. Use this mobile number when prompted. Reply STOP to opt out.`); return ok(res, { id: lender_id, sms: _sms }); } catch (err) { logger.error({ err }, "create lender failed"); return badRequest(res, "create failed"); } });
router.patch("/admin/lenders/:id", async (req, res) => { const id = req.params.id; const b = (req.body ?? {}) as Record<string, unknown>; if (b.country !== undefined && !COUNTRY_RE.test(String(b.country).toUpperCase())) return badRequest(res, "country must be CA or US"); const setSql: string[] = []; const vals: unknown[] = [id]; let i = 2; const cols = ["company_name","website_url","address_line1","city","province","postal_code","country","contact_full_name","contact_email","contact_phone_e164","is_active"]; for (const c of cols) { if (b[c] !== undefined) { setSql.push(`${c} = $${i++}`); vals.push(c === "country" ? String(b[c]).toUpperCase() : b[c]); }} if (!setSql.length) return badRequest(res, "no fields to update"); await pool.query(`UPDATE bi_lenders SET ${setSql.join(", ")} WHERE id = $1`, vals); /* BI_SERVER_BLOCK_v237_REVOKE_KEYS_ON_DEACTIVATE_v1 */ let _keysRevoked = 0; if (b.is_active === false) { _keysRevoked = await revokeLenderKeys(id); } return ok(res, { updated: true, keys_revoked: _keysRevoked }); });
/* BI_SERVER_BLOCK_v237_REVOKE_KEYS_ON_DEACTIVATE_v1 — atomically revoke API keys on lender deactivation */
router.delete("/admin/lenders/:id", async (req, res) => {
  const id = req.params.id;
  await pool.query(`UPDATE bi_lenders SET is_active = FALSE WHERE id = $1`, [id]);
  const revoked = await revokeLenderKeys(id);
  return ok(res, { deactivated: true, keys_revoked: revoked });
});

// BI_SERVER_BLOCK_v412_LENDER_SMS_NORMALIZE_AND_PURGE_v1 — HARD delete (admin-only; this
// whole router is admin-gated at the top). All child FKs are ON DELETE CASCADE (api keys,
// contacts, login contacts) or SET NULL (applications, CRM contacts), so this removes the
// lender + its own records and only nulls the lender link on applications — apps are kept.
router.delete("/admin/lenders/:id/purge", async (req, res) => {
  const id = req.params.id;
  const r = await pool.query(`DELETE FROM bi_lenders WHERE id = $1 RETURNING id`, [id]);
  if (!r.rowCount) return badRequest(res, "lender not found");
  return ok(res, { purged: true, id });
});

// BI_SERVER_BLOCK_v412_LENDER_SMS_NORMALIZE_AND_PURGE_v1 — re-send the lender invite SMS.
router.post("/admin/lenders/:id/resend-invite", async (req, res) => {
  const id = req.params.id;
  const lr = await pool.query<{ company_name: string; contact_full_name: string | null; contact_phone_e164: string | null }>(
    `SELECT company_name, contact_full_name, contact_phone_e164 FROM bi_lenders WHERE id = $1`,
    [id],
  );
  if (!lr.rowCount) return badRequest(res, "lender not found");
  const row = lr.rows[0]!;
  if (!row.contact_phone_e164) return badRequest(res, "lender has no contact phone");
  const sms = await sendBiSms(
    row.contact_phone_e164,
    `Boreal Risk: ${row.contact_full_name || "your lender account"}, sign in to the lender portal: https://www.boreal.insure/lender/login. Use this mobile number when prompted. Reply STOP to opt out.`,
  );
  return ok(res, { id, sms });
});

// BI_SERVER_BLOCK_v414_LENDER_LOGIN_PROVISION_v1 — one-shot backfill: provision login rows
// for every already-active lender contact + primary lender contact missing one. Admin-only
// (router is admin-gated). Idempotent; safe to run repeatedly.
router.post("/admin/lenders/backfill-login", async (_req, res) => {
  const contacts = await pool.query<{ lender_id: string; full_name: string | null; email: string | null; phone_e164: string | null; role: string | null }>(
    `SELECT c.lender_id, c.full_name, c.email, c.phone_e164, c.role
       FROM bi_lender_contacts c JOIN bi_lenders l ON l.id = c.lender_id
      WHERE c.is_active = TRUE AND l.is_active = TRUE`,
  );
  for (const c of contacts.rows) await provisionLoginContact(c.lender_id, { phone: c.phone_e164, email: c.email, full_name: c.full_name, role: c.role });
  const primaries = await pool.query<{ id: string; contact_full_name: string | null; contact_email: string | null; contact_phone_e164: string | null }>(
    `SELECT id, contact_full_name, contact_email, contact_phone_e164 FROM bi_lenders WHERE is_active = TRUE`,
  );
  for (const l of primaries.rows) await provisionLoginContact(l.id, { phone: l.contact_phone_e164, email: l.contact_email, full_name: l.contact_full_name, role: "primary" });
  return ok(res, { backfilled: true, contacts_seen: contacts.rowCount ?? 0, lenders_seen: primaries.rowCount ?? 0 });
});
// BI_SERVER_BLOCK_v65_LENDER_API_KEY_MINT_v1 — staff mints/lists/revokes
// API keys for a given BI-lender. Secret is shown ONCE on creation, hashed
// at rest. Bearer auth on biLenderApiRoutes verifies via key_hash.
// BI_SERVER_BLOCK_v266_LENDER_ADMIN_FIXES_v1
// Show the wire prefix (key_prefix column, e.g. "bk_a1b2c3...") not
// a slice of the SHA-256 hash. The hash bytes are meaningless to the
// operator and don't match the secret they saved when minting.
router.get("/admin/lenders/:id/api-keys", async (req, res) => {
  const r = await pool.query(
    `SELECT id, key_prefix, is_active, last_used_at, created_at
       FROM bi_lender_api_keys
      WHERE lender_id = $1
      ORDER BY created_at DESC`,
    [req.params.id]
  );
  const items = r.rows.map((row: any) => ({
    id: row.id,
    prefix: typeof row.key_prefix === "string" ? row.key_prefix : "",
    is_active: row.is_active,
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

// BI_SERVER_BLOCK_v266_LENDER_ADMIN_FIXES_v1
// Live column is `is_active` (master schema 20260428). Old `active`
// column lives only in the duplicate CREATE TABLE in 2026_05_03 which
// is a no-op. Also set revoked_at so audit matches bulk revoke (see
// revokeLenderKeys helper earlier in this file).
router.post("/admin/lenders/:id/api-keys/:keyId/revoke", async (req, res) => {
  const r = await pool.query(
    `UPDATE bi_lender_api_keys
        SET is_active = FALSE, revoked_at = NOW()
      WHERE id = $1 AND lender_id = $2 AND is_active = TRUE
    RETURNING id`,
    [req.params.keyId, req.params.id]
  );
  return ok(res, { revoked: (r.rowCount ?? 0) > 0 });
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
// BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1
// POST /admin/apollo/sync-now — kick the contact sync NOW. Accepts
// { include_not_in_sequence?: boolean, since?: string|null }. Use this
// after creating a list in Apollo to pull contacts that aren't yet
// enrolled into a sequence.
router.post("/admin/apollo/sync-now", async (req, res) => {
  const include = req.body?.include_not_in_sequence === true;
  const sinceOverride = typeof req.body?.since === "string" ? req.body.since : (req.body?.since === null ? null : undefined);
  try {
    const result = await runContactSyncOnce({ includeNotInSequence: include, sinceOverride });
    return res.json({ ok: true, ...result, opts: { includeNotInSequence: include, since: sinceOverride === undefined ? "watermark" : sinceOverride } });
  } catch (e) {
    return res.status(500).json({ error: "apollo_sync_failed", message: e instanceof Error ? e.message : String(e) });
  }
});

// BI_SERVER_BLOCK_58_APOLLO_LIST_IMPORT_v1
// GET /admin/apollo/lists  — proxy to Apollo /labels with our key
// POST /admin/apollo/lists/:id/import — pull every contact in that list,
//   upsert into bi_contacts (creating bi_companies on first sighting),
//   tag each contact's apollo_label_ids with the source list id.
router.get("/admin/apollo/lists", async (_req, res) => {
  if (process.env.APOLLO_API_KEY == null || process.env.APOLLO_API_KEY === "") {
    return res.status(503).json({ error: "apollo_not_configured", message: "APOLLO_API_KEY missing" });
  }
  try {
    const r = await _apolloListLabels();
    return res.json({ lists: r.labels.map((l) => ({ id: l.id, name: l.name, count: l.cached_count ?? null, updated_at: l.updated_at ?? null })) });
  } catch (e) {
    return res.status(502).json({ error: "apollo_lists_failed", message: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/apollo/lists/:id/import", async (req, res) => {
  // v340: graceful 422 — surface Apollo's payload errors to the UI cleanly.
  try {

  if (process.env.APOLLO_API_KEY == null || process.env.APOLLO_API_KEY === "") {
    return res.status(503).json({ error: "apollo_not_configured" });
  }
    const labelId = String(req.params.id || "").trim();
    if (!labelId) return res.status(400).json({ error: "missing_label_id" });
    const MAX_PAGES = 100; // 100 * 100 = 10,000 contacts ceiling per import call
    const startedAt = Date.now();
    let page = 1;
    let totalPages = 1;
    let upserted = 0;
    let created = 0;
    let errors = 0;
  // BI_SERVER_BLOCK_73_APOLLO_LIST_FORK_v1 - label may be People or Companies; try people first, fall through to companies.
  let source: "people" | "companies" | "empty" = "empty";
  let errorPath: "none" | "people_search" | "people_upsert" | "companies_search" | "companies_upsert" = "none";
  let peopleHttpOk = false;
  let companiesHttpOk = false;
  try {
    // Step 1: try /contacts/search with label_ids (user's saved+enriched contacts).
    while (page <= totalPages && page <= MAX_PAGES) {
      let people: any[] = [];
      let pagination: { total_pages?: number; total_entries?: number } = { total_pages: 1, total_entries: 0 };
      try {
        // v329: /mixed_people/search returns Apollo's prospect universe filtered by label.
        // The previous /contacts/search only returned enriched contacts, which is empty
        // on Basic plans (Apollo gates contact enrichment behind credits).
        const peopleRes = await _apolloSearchPeopleByLabel({ page, per_page: 100, label_ids: [labelId] });
        peopleHttpOk = true;
        people = peopleRes.people ?? [];
        pagination = peopleRes.pagination ?? pagination;
      } catch (err) {
        errorPath = "people_search";
        throw err;
      }
      totalPages = pagination.total_pages || 1;
      // BI_SERVER_BLOCK_v392_MARKETING_IMPORT_FIX_v1
      logger.info({
        label_id: labelId,
        page,
        apollo_total_entries: pagination.total_entries ?? 0,
        fetched_on_page: people.length,
        deduped_count: people.length,
        people_http_ok: peopleHttpOk,
        response_shape: {
          has_people: Array.isArray(people),
          people_count: people.length,
          has_companies: false,
          companies_count: 0,
          total_entries: pagination.total_entries ?? null,
        },
        error_path: errorPath,
      }, "apollo list import contacts response");
      // BI_SERVER_BLOCK_v346_APOLLO_TOTAL_ENTRIES_GATE_v1 — when Apollo ignores
      // label_ids on mixed_people/api_search (happens on Basic plans + when the
      // saved-list ID isn\'t a real label), it returns a 100-row page of the
      // prospect UNIVERSE but reports total_entries:0. Importing those would
      // fill the CRM with random people who aren\'t on the list (Todd\'s
      // 8-member list imported 100). Trust total_entries.
      if (page === 1 && (pagination.total_entries ?? 0) === 0) {
        logger.warn({
          label_id: labelId,
          page,
          people_received: people?.length ?? 0,
          total_entries: pagination.total_entries ?? null,
          msg: "apollo people search returned rows but total_entries=0; filter likely ignored",
        }, "apollo list import skipped people path");
        break;
      }
      source = "people";
      for (const person of people ?? []) {
        try {
          const r = await _apolloUpsertByLabel(person as any, { sourceLabelId: labelId });
          upserted += 1;
          if (r.created) created += 1;
        } catch {
          errorPath = "people_upsert";
          errors += 1;
        }
      }
      page += 1;
    }
    // Step 2: if people path returned nothing, try /mixed_companies/search.
    if (source === "empty") {
      page = 1;
      totalPages = 1;
      while (page <= totalPages && page <= MAX_PAGES) {
        let organizations: any[] = [];
        let pagination: { total_pages?: number; total_entries?: number } = { total_pages: 1, total_entries: 0 };
        try {
          const companyRes = await _apolloSearchCompaniesByLabel({ page, per_page: 100, label_ids: [labelId] });
          companiesHttpOk = true;
          organizations = companyRes.organizations ?? [];
          pagination = companyRes.pagination ?? pagination;
        } catch (err: any) {
          // BI_SERVER_BLOCK_v348_APOLLO_404_GRACEFUL_v1 — Apollo returns 404
          // for some accounts on /mixed_companies/api_search (endpoint may
          // be plan-gated or label_id-specific). Treat as empty rather than
          // crashing so partial people-side results commit and the portal
          // sees a clean response instead of 422.
          errorPath = "companies_search";
          const status = err?.status ?? err?.response?.status;
          if (status === 404) {
            logger.warn({ label_id: labelId, err: err?.message }, "apollo companies search 404 — treating as empty");
            organizations = [];
            pagination = { total_pages: 0, total_entries: 0 };
            companiesHttpOk = false;
          } else {
            throw err;
          }
        }
        totalPages = pagination.total_pages || 1;
        logger.info({
          label_id: labelId,
          page,
          companies_http_ok: companiesHttpOk,
          response_shape: {
            has_people: false,
            people_count: 0,
            has_companies: Array.isArray(organizations),
            companies_count: organizations.length,
            total_entries: pagination.total_entries ?? null,
          },
          error_path: errorPath,
        }, "apollo list import companies response");
        if (page === 1 && (organizations?.length ?? 0) === 0) break;
        source = "companies";
        for (const org of organizations ?? []) {
          try {
            const orgName = String(org?.name ?? "").trim();
            if (!orgName) { errors += 1; continue; }
            const existing = await pool.query<{ id: string }>(
              `SELECT id FROM bi_companies WHERE LOWER(legal_name) = LOWER($1) OR LOWER(operating_name) = LOWER($1) LIMIT 1`,
              [orgName]
            );
            if (existing.rows[0]?.id) {
              upserted += 1;
            } else {
              await pool.query(
                `INSERT INTO bi_companies (legal_name, industry, kind) VALUES ($1, $2, 'lender')`,
                [orgName, org?.industry ?? null]
              );
              upserted += 1;
              created += 1;
            }
          } catch {
            errorPath = "companies_upsert";
            errors += 1;
          }
        }
        page += 1;
      }
    }
    const elapsed_ms = Date.now() - startedAt;
    logger.info({
      label_id: labelId,
      source,
      people_http_ok: peopleHttpOk,
      companies_http_ok: companiesHttpOk,
      upserted,
      created,
      errors,
      elapsed_ms,
      error_path: errorPath,
    }, "apollo list import finished");
    return res.json({ ok: true, label_id: labelId, source, pages: page - 1, total_pages: totalPages, upserted, created, errors, elapsed_ms, capped: totalPages > MAX_PAGES });
  } catch (e: any) {
    const message = getApolloErrorMessage(e);
    req.log?.error?.({ err: e, listId: req.params.id, stack: e?.stack }, "apollo_import_failed");
    logger.error({
      err: e,
      label_id: labelId,
      source,
      people_http_ok: peopleHttpOk,
      companies_http_ok: companiesHttpOk,
      upserted,
      created,
      errors,
      error_path: errorPath,
      apollo_message: message,
    }, "apollo list import failed");
    return res.status(422).json({ error: "apollo_import_failed", source, upserted, created, errors, error_path: errorPath, message });
  }

  } catch (err) {
    const isApollo = err && (err as any).name === "ApolloError";
    const status = isApollo && (err as any).status === 422 ? 422 : 502;
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "apollo_list_import_failed");
    return res.status(status).json({
      error: isApollo ? "apollo_rejected_request" : "apollo_import_failed",
      message: err instanceof Error ? err.message : String(err),
      hint: status === 422 ? "Apollo rejected the list id or label format. Verify the label is People (not Companies) and that your Apollo plan includes /mixed_people/search." : undefined,
    });
  }
});

// BI_SERVER_BLOCK_60_MAILBOX_ENGAGEMENT_TEMPLATES_v1
// Apollo mailbox connect status. Pulls live from Apollo's /v1/email_accounts
// and falls back to the cached bi_apollo_email_accounts row when Apollo is
// rate-limited or unreachable. The "status" column tracks Apollo's own
// designation (active / paused / disconnected / warming).
router.get("/admin/apollo/mailboxes", async (_req, res) => {
  if (!process.env.APOLLO_API_KEY) {
    return res.status(503).json({ error: "apollo_not_configured" });
  }
  try {
    const r = await _apolloListEmailAccounts();
    const live = Array.isArray(r.email_accounts) ? r.email_accounts : [];
    for (const acct of live) {
      await pool.query(
        `INSERT INTO bi_apollo_email_accounts (apollo_account_id, email, daily_send_count, bounce_rate_30d, reply_rate_30d, status, raw_data, last_synced_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
         ON CONFLICT (apollo_account_id) DO UPDATE
         SET email = EXCLUDED.email, daily_send_count = EXCLUDED.daily_send_count, bounce_rate_30d = EXCLUDED.bounce_rate_30d, reply_rate_30d = EXCLUDED.reply_rate_30d, status = EXCLUDED.status, raw_data = EXCLUDED.raw_data, last_synced_at = NOW()`,
        [acct.id, acct.email ?? "", acct.emails_sent_today ?? 0, acct.bounce_rate ?? null, acct.reply_rate ?? null, acct.status ?? "unknown", JSON.stringify(acct)],
      ).catch(() => {});
    }
    return res.json({
      mailboxes: live.map((a: any) => ({
        id: a.id,
        email: a.email ?? null,
        status: a.status ?? "unknown",
        daily_limit: a.send_limit_per_day ?? null,
        sent_today: a.emails_sent_today ?? 0,
        bounce_rate: a.bounce_rate ?? null,
        reply_rate: a.reply_rate ?? null,
      })),
      source: "live",
    });
  } catch (e) {
    const fallback = await pool.query(`SELECT apollo_account_id AS id, email, status, daily_send_count AS sent_today, bounce_rate_30d AS bounce_rate, reply_rate_30d AS reply_rate, last_synced_at FROM bi_apollo_email_accounts ORDER BY email`).catch(() => ({ rows: [] }));
    return res.json({ mailboxes: fallback.rows, source: "cache", error: e instanceof Error ? e.message : String(e) });
  }
});

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
  await provisionLoginContact(lender_id, { phone: phone_e164, email, full_name, role }); // BI_SERVER_BLOCK_v414_LENDER_LOGIN_PROVISION_v1
  const _sms = await sendBiSms(phone_e164, `Boreal Risk: Hi ${full_name.split(/\s+/)[0]}, you've been added as a contact for ${lr.rows[0].company_name}. Sign in to submit applications: https://www.boreal.insure/lender/login. Use this number when prompted. Reply STOP to opt out.`);
  return ok(res, { id: contact_id, sms: _sms });
});

// BI_SERVER_BLOCK_v277_LENDER_CONTACT_DELETE_RESEND_v1
// Soft-delete a lender contact. is_active=FALSE removes their login
// access on the next OTP attempt (biLenderApiRoutes filters
// is_active=TRUE in the lookup). updated_at is bumped for audit.
router.delete("/admin/lenders/:id/contacts/:contactId", async (req, res) => {
  const lenderId = req.params.id;
  const contactId = req.params.contactId;
  const r = await pool.query<{ id: string }>(
    `UPDATE bi_lender_contacts
        SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND lender_id = $2 AND is_active = TRUE
    RETURNING id`,
    [contactId, lenderId]
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: "contact_not_found_or_already_inactive" });
  }
  return ok(res, { deactivated: true });
});

// BI_SERVER_BLOCK_v277_LENDER_CONTACT_DELETE_RESEND_v1
// Resend the welcome SMS that the POST handler fires on contact
// creation. Useful when the lender lost the original message or
// didn't receive it. Phone must still be on an active contact.
router.post("/admin/lenders/:id/contacts/:contactId/resend-invite", async (req, res) => {
  const lenderId = req.params.id;
  const contactId = req.params.contactId;
  const r = await pool.query<{ full_name: string; phone_e164: string; company_name: string }>(
    `SELECT c.full_name, c.phone_e164, l.company_name
       FROM bi_lender_contacts c
       JOIN bi_lenders l ON l.id = c.lender_id
      WHERE c.id = $1 AND c.lender_id = $2 AND c.is_active = TRUE
      LIMIT 1`,
    [contactId, lenderId]
  );
  const row = r.rows[0];
  if (!row) {
    return res.status(404).json({ error: "contact_not_found_or_inactive" });
  }
  const firstName = row.full_name.split(/\s+/)[0] || row.full_name;
  // BI_SERVER_BLOCK_v414_LENDER_LOGIN_PROVISION_v1 — return the real send result (was hardcoded sent:true).
  const sms = await sendBiSms(
    row.phone_e164,
    `Boreal Risk: Hi ${firstName}, you've been added as a contact for ${row.company_name}. Sign in to submit applications: https://www.boreal.insure/lender/login. Use this number when prompted. Reply STOP to opt out.`,
  );
  return ok(res, sms);
});

// BF_BLOCK_v416_PURGE_DEMO_APPS_v1 — hard-delete demo/test BI applications.
// Admin-only. FK CASCADE on bi_applications children (bi_documents,
// bi_activity, etc.) cleans up automatically. Targets apps flagged is_demo
// OR belonging to a demo/test lender (lender is_demo flag, or company_name
// containing 'demo'/'test'). Lenders are NOT touched
// (Todd ruling 2026-06-01: delete demo/test APPS only).
router.post("/admin/apps/purge-demo", async (req, res) => {
  const role = String(((req as any).user?.role) ?? "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ ok: false, error: "forbidden", message: "Only Admin may purge demo data." });
  }
  try {
    const r = await pool.query<{ id: string }>(
      `DELETE FROM bi_applications a
        WHERE COALESCE(a.is_demo, FALSE) = TRUE
           OR a.lender_id IN (
                SELECT id FROM bi_lenders
                 WHERE COALESCE(is_demo, FALSE) = TRUE
                    OR company_name ILIKE '%demo%'
                    OR company_name ILIKE '%test%'
              )
        RETURNING a.id`
    );
    return res.status(200).json({ ok: true, deleted: r.rowCount ?? 0, ids: r.rows.map((x) => x.id) });
  } catch (err) {
    logger.error({ err }, "purge demo apps failed");
    return res.status(500).json({ ok: false, error: "purge_failed" });
  }
});

export default router;
