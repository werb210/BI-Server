import { Router } from "express";
// BI_SERVER_BLOCK_v254_CRM_CONTACTS_ENHANCED_v1
import { logger } from "../platform/logger";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

/* =========================
   CONTACTS
========================= */
// BI_SERVER_BLOCK_v254_CRM_CONTACTS_ENHANCED_v1
// Search + sort + owner filter + pagination + company_name join.
// The legacy four-column shape (id, full_name, email, phone_e164)
// is preserved; new columns are additive so existing callers
// continue to work without code changes.
const CONTACTS_SORT_COLS: Record<string, string> = {
  name: "c.full_name",
  full_name: "c.full_name",
  company_name: "co.legal_name",
  lead_status: "c.outreach_status",
  outreach_status: "c.outreach_status",
  owner_name: "c.outreach_owner_id",
  created_at: "c.created_at",
};

router.get("/crm/contacts", async (req, res) => {
  const search =
    typeof req.query.q === "string"
      ? req.query.q.trim()
      : typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";
  const ownerId =
    typeof req.query.owner_id === "string" ? req.query.owner_id.trim() : "";
  const leadStatus =
    typeof req.query.lead_status === "string"
      ? req.query.lead_status.trim()
      : typeof req.query.outreach_status === "string"
        ? req.query.outreach_status.trim()
        : "";
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 200, 1), 500);
  const offset = (page - 1) * pageSize;

  // Sort whitelist; unknown values fall back to created_at desc.
  const rawSort = typeof req.query.sort === "string" ? req.query.sort : "";
  const [sortColRaw, sortDirRaw] = rawSort.split(":");
  const sortCol = CONTACTS_SORT_COLS[sortColRaw] ?? "c.created_at";
  const sortDir =
    sortDirRaw && sortDirRaw.toLowerCase() === "asc" ? "ASC" : "DESC";

  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (search) {
    where.push(
      `(c.full_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone_e164 ILIKE $${i} OR co.legal_name ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }
  if (ownerId) {
    where.push(`c.outreach_owner_id = $${i++}`);
    params.push(ownerId);
  }
  if (leadStatus) {
    where.push(`c.outreach_status = $${i++}`);
    params.push(leadStatus);
  }

  const sql = `
    SELECT c.id,
           c.full_name,
           c.email,
           c.phone_e164,
           c.title,
           c.tags,
           c.notes,
           c.outreach_status,
           c.outreach_owner_id,
           c.outreach_updated_at,
           c.company_id,
           co.legal_name AS company_name,
           c.created_at,
           c.updated_at
      FROM bi_contacts c
      LEFT JOIN bi_companies co ON co.id = c.company_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ${pageSize}
     OFFSET ${offset}
  `;
  try {
    const r = await pool.query(sql, params);
    ok(res, r.rows);
  } catch (err: any) {
    logger.error({ err }, "bi_crm_contacts_list_failed");
    return res.status(500).json({ error: "list_failed" });
  }
});

// BI_SERVER_BLOCK_v254_CRM_CONTACTS_ENHANCED_v1
// Single-contact detail — drives the upcoming BI contact detail
// page. Returns the same column set as the list, plus a small
// activity_count for the timeline header badge.
router.get("/crm/contacts/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const r = await pool.query(
      `SELECT c.id,
              c.full_name,
              c.email,
              c.phone_e164,
              c.title,
              c.tags,
              c.notes,
              c.outreach_status,
              c.outreach_owner_id,
              c.outreach_updated_at,
              c.company_id,
              co.legal_name AS company_name,
              co.operating_name AS company_operating_name,
              c.created_at,
              c.updated_at,
              (SELECT COUNT(*)::int FROM bi_contact_activity a WHERE a.contact_id = c.id) AS activity_count
         FROM bi_contacts c
         LEFT JOIN bi_companies co ON co.id = c.company_id
        WHERE c.id = $1
        LIMIT 1`,
      [id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    return ok(res, r.rows[0]);
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_contact_get_failed");
    return res.status(500).json({ error: "get_failed" });
  }
});

// BI_SERVER_BLOCK_v255_CRM_CONTACTS_EDIT_DELETE_SMS_v1
// General-purpose contact PATCH. Distinct from the v251 outreach
// PATCH at /crm/outreach/contacts/:id which handles outreach_status
// + outreach_owner_id and auto-logs status_change activity. This
// endpoint covers identity fields: full_name, email, phone_e164,
// title, notes. Pass `null` to clear a field. Unknown fields are
// ignored. Empty body returns no_op.
function v255NormPhone(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return digits || null;
}

function v255S(v: unknown, max = 1000): string | null {
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

router.patch("/crm/contacts/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  const b: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (b.full_name !== undefined) {
    sets.push(`full_name = $${i++}`);
    params.push(v255S(b.full_name, 200));
  }
  if (b.email !== undefined) {
    const email = b.email === null ? null : v255S(b.email, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    sets.push(`email = $${i++}`);
    params.push(email ? email.toLowerCase() : null);
  }
  if (b.phone_e164 !== undefined || b.phone !== undefined) {
    const phone = v255NormPhone(b.phone_e164 ?? b.phone);
    sets.push(`phone_e164 = $${i++}`);
    params.push(phone);
  }
  if (b.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(v255S(b.title, 200));
  }
  if (b.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    params.push(v255S(b.notes, 8000));
  }
  if (b.company_id !== undefined) {
    const companyId = b.company_id === null ? null : v255S(b.company_id);
    sets.push(`company_id = $${i++}`);
    params.push(companyId);
  }

  if (sets.length === 0) {
    return res.json({ ok: true, no_op: true });
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const r = await pool.query(
      `UPDATE bi_contacts SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
      params,
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err: any) {
    // Surface FK / unique constraint violations distinctly.
    if (typeof err?.message === "string" && err.message.includes("bi_companies")) {
      return res.status(400).json({ error: "company_not_found" });
    }
    logger.error({ err, id }, "bi_crm_contact_patch_failed");
    return res.status(500).json({ error: "patch_failed" });
  }
});

// BI_SERVER_BLOCK_v255_CRM_CONTACTS_EDIT_DELETE_SMS_v1
// DELETE a contact. bi_contact_activity has ON DELETE CASCADE
// from v251 so timeline rows are removed automatically. Other
// tables (bi_apollo_enrichment, bi_apollo_enrollment from v253)
// also cascade. Apollo state in the cloud is NOT cleaned up here;
// a future block can add a webhook + soft-delete if Apollo offers
// a contact-unsubscribe API.
router.delete("/crm/contacts/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const r = await pool.query(
      `DELETE FROM bi_contacts WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_contact_delete_failed");
    return res.status(500).json({ error: "delete_failed" });
  }
});

// BI_SERVER_BLOCK_v255_CRM_CONTACTS_EDIT_DELETE_SMS_v1
// POST /crm/contacts/:id/sms — staff sends a free-text SMS to a
// contact. Logs an 'sms' activity row regardless of outcome.
// Reuses sendOutreachSms from v252.
router.post("/crm/contacts/:id/sms", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  const actor = ((req as any).user ?? {}) as { staffUserId?: string };
  const staffId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;
  if (!staffId) return res.status(400).json({ error: "no_staff_user_id" });

  const bodyText = v255S((req.body as any)?.body, 1000);
  if (!bodyText) return res.status(400).json({ error: "body_required" });

  let contactPhone: string | null = null;
  try {
    const cr = await pool.query<{ phone_e164: string | null }>(
      `SELECT phone_e164 FROM bi_contacts WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!cr.rows[0]) return res.status(404).json({ error: "not_found" });
    contactPhone = cr.rows[0].phone_e164;
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_contact_sms_lookup_failed");
    return res.status(500).json({ error: "lookup_failed" });
  }
  if (!contactPhone) return res.status(400).json({ error: "contact_has_no_phone" });

  // Lazy import to keep the route file free of top-level Twilio
  // dependency for environments that don't ship Twilio at all.
  const { sendOutreachSms } = await import("../services/smsService");

  let sid: string | null = null;
  let smsOk = false;
  let smsError: string | null = null;
  try {
    const r = await sendOutreachSms(contactPhone, bodyText);
    sid = r.sid;
    smsOk = true;
  } catch (err: any) {
    smsError = err?.message ?? "sms_failed";
    logger.error({ err, to: contactPhone }, "bi_crm_contact_sms_failed");
  }

  try {
    await pool.query(
      `INSERT INTO bi_contact_activity
         (id, contact_id, actor_id, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, $2, 'sms', $3, $4, $5::jsonb)`,
      [
        id,
        staffId,
        smsOk ? "sent" : "failed",
        bodyText,
        JSON.stringify({ sid, kind: "manual", error: smsError }),
      ],
    );
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_contact_sms_log_failed");
  }

  if (!smsOk) {
    return res.status(502).json({ error: "sms_failed", detail: smsError });
  }
  return res.json({ ok: true, sid });
});

/* =========================
   REFERRERS
========================= */
router.get("/crm/referrers", async (_req, res) => {
  const result = await pool.query(`
    SELECT id, full_name, company_name, agreement_status
    FROM bi_referrers
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);
});

/* =========================
   LENDERS
========================= */
router.get("/crm/lenders", async (_req, res) => {
  const result = await pool.query(`
    -- BI_SERVER_BLOCK_v157_BF_JWT_INTEROP_AND_CRM_FIX_v1
    -- bi_lenders has contact_full_name, not rep_full_name. The
    -- old column name caused /api/v1/bi/crm/lenders to 500 on
    -- every call from the BI silo CRM page.
    SELECT id, contact_full_name, company_name
    FROM bi_lenders
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);
});

export default router;
