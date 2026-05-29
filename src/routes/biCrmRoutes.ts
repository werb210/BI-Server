import { Router } from "express";
// BI_SERVER_BLOCK_v254_CRM_CONTACTS_ENHANCED_v1
import { logger } from "../platform/logger";
import { Pool } from "pg";
import { env } from "../platform/env";
import { ApolloError, matchPerson } from "../integrations/apollo/apolloClient";

import { badRequest, ok } from "../utils/apiResponse";
import { hasCapability } from "../platform/capabilities";

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

// BI_SERVER_BLOCK_60_MAILBOX_ENGAGEMENT_TEMPLATES_v1
// Per-contact Apollo engagement events (opens/clicks/replies/bounces).
router.get("/crm/contacts/:id/engagement", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return badRequest(res, "missing_contact_id");
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  try {
    const r = await pool.query(
      `SELECT id, event_type, source, apollo_message_id, sequence_name, occurred_at, metadata
         FROM bi_crm_engagement_events
        WHERE contact_id = $1
        ORDER BY occurred_at DESC
        LIMIT $2`,
      [id, limit],
    );
    return res.json({ events: r.rows });
  } catch (e) {
    return res.status(500).json({ error: "engagement_query_failed", message: e instanceof Error ? e.message : String(e) });
  }
});

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

  const where: string[] = ["c.converted_to_company_id IS NULL"];
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
  const tagsQueryRaw = typeof req.query.tags === "string" ? req.query.tags : "";
  if (tagsQueryRaw) {
    const tags = tagsQueryRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length) {
      where.push(`c.tags && $${i++}::text[]`);
      params.push(tags);
    }
  }

  const sql = `
    SELECT c.id,
           c.full_name,
           c.first_name,
           c.last_name,
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
           c.created_at
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
              c.first_name,
              c.last_name,
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
  if (b.first_name !== undefined) {
    sets.push(`first_name = $${i++}`);
    params.push(v255S(b.first_name, 100));
  }
  if (b.last_name !== undefined) {
    sets.push(`last_name = $${i++}`);
    params.push(v255S(b.last_name, 100));
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
  if (b.tags !== undefined) {
    if (b.tags === null) {
      sets.push(`tags = $${i++}`);
      params.push(null);
    } else if (Array.isArray(b.tags)) {
      const tags = b.tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0)
        .filter((t) => t.length <= 60)
        .slice(0, 20);
      sets.push(`tags = $${i++}::text[]`);
      params.push(tags);
    } else {
      return res.status(400).json({ error: "tags_must_be_array_or_null" });
    }
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

// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1
// Companies list with search + sort + pagination. Same shape as
// v254 contacts list. owner_id is left as a placeholder — bi_companies
// doesn't have an owner column today; if marketing wants per-company
// staff ownership it lands as a one-line column add later.
const COMPANIES_SORT_COLS: Record<string, string> = {
  name: "legal_name",
  legal_name: "legal_name",
  industry: "industry",
  created_at: "created_at",
};

router.get("/crm/companies", async (req, res) => {
  const search =
    typeof req.query.q === "string"
      ? req.query.q.trim()
      : typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";
  const industry =
    typeof req.query.industry === "string" ? req.query.industry.trim() : "";
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 200, 1), 500);
  const offset = (page - 1) * pageSize;

  const rawSort = typeof req.query.sort === "string" ? req.query.sort : "";
  const [sortColRaw, sortDirRaw] = rawSort.split(":");
  const sortCol = COMPANIES_SORT_COLS[sortColRaw] ?? "created_at";
  const sortDir =
    sortDirRaw && sortDirRaw.toLowerCase() === "asc" ? "ASC" : "DESC";

  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (search) {
    where.push(
      `(legal_name ILIKE $${i} OR operating_name ILIKE $${i} OR business_number ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }
  if (industry) {
    where.push(`industry = $${i++}`);
    params.push(industry);
  }

  const sql = `
    SELECT id,
           legal_name,
           operating_name,
           business_number,
           address_line1,
           city,
           province,
           postal_code,
           industry,
           created_at,
           (SELECT COUNT(*)::int FROM bi_contacts c WHERE c.company_id = bi_companies.id) AS contact_count
      FROM bi_companies
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT ${pageSize}
     OFFSET ${offset}
  `;
  try {
    const r = await pool.query(sql, params);
    ok(res, r.rows);
  } catch (err: any) {
    logger.error({ err }, "bi_crm_companies_list_failed");
    return res.status(500).json({ error: "list_failed" });
  }
});

// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1
// Detail endpoint with three rollups in one round trip: the
// company row itself, contacts at that company, and applications
// where the company is the applicant. application_count and
// contact_count badges drive the portal header.
router.get("/crm/companies/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  try {
    const co = await pool.query(
      `SELECT id, legal_name, operating_name, business_number,
              address_line1, city, province, postal_code, industry,
              created_at,
              (SELECT COUNT(*)::int FROM bi_contacts c WHERE c.company_id = bi_companies.id) AS contact_count,
              (SELECT COUNT(*)::int FROM bi_applications a WHERE a.company_id = bi_companies.id) AS application_count
         FROM bi_companies
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    if (!co.rows[0]) return res.status(404).json({ error: "not_found" });

    const contacts = await pool.query(
      `SELECT id, full_name, email, phone_e164, title, outreach_status, created_at
         FROM bi_contacts
        WHERE company_id = $1
        ORDER BY full_name ASC
        LIMIT 200`,
      [id],
    );

    // bi_applications may exist in multiple shapes across schemas;
    // select the minimal columns the portal needs.
    let applications: Array<Record<string, unknown>> = [];
    try {
      const apps = await pool.query(
        `SELECT id, application_code, stage, status, created_at
           FROM bi_applications
          WHERE company_id = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [id],
      );
      applications = apps.rows;
    } catch {
      // Older schemas may not have company_id on bi_applications.
      applications = [];
    }

    return ok(res, {
      company: co.rows[0],
      contacts: contacts.rows,
      applications,
    });
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_company_get_failed");
    return res.status(500).json({ error: "get_failed" });
  }
});

// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1
// POST /crm/companies — create a new company. legal_name required;
// everything else optional. Returns the new row id.
router.post("/crm/companies", async (req, res) => {
  const b: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>;
  const legalName =
    typeof b.legal_name === "string" ? b.legal_name.trim().slice(0, 200) : "";
  if (!legalName) return res.status(400).json({ error: "legal_name_required" });

  const operatingName =
    b.operating_name === null ? null :
    typeof b.operating_name === "string" ? b.operating_name.trim().slice(0, 200) || null : null;
  const businessNumber =
    b.business_number === null ? null :
    typeof b.business_number === "string" ? b.business_number.trim().slice(0, 50) || null : null;
  const addressLine1 =
    b.address_line1 === null ? null :
    typeof b.address_line1 === "string" ? b.address_line1.trim().slice(0, 200) || null : null;
  const city =
    b.city === null ? null :
    typeof b.city === "string" ? b.city.trim().slice(0, 100) || null : null;
  const province =
    b.province === null ? null :
    typeof b.province === "string" ? b.province.trim().slice(0, 50) || null : null;
  const postalCode =
    b.postal_code === null ? null :
    typeof b.postal_code === "string" ? b.postal_code.trim().slice(0, 20) || null : null;
  const industry =
    b.industry === null ? null :
    typeof b.industry === "string" ? b.industry.trim().slice(0, 200) || null : null;

  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO bi_companies
         (legal_name, operating_name, business_number, address_line1, city, province, postal_code, industry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [legalName, operatingName, businessNumber, addressLine1, city, province, postalCode, industry],
    );
    return res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err: any) {
    logger.error({ err }, "bi_crm_company_create_failed");
    return res.status(500).json({ error: "create_failed" });
  }
});

// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1
// PATCH /crm/companies/:id — general-purpose company update.
// Send `null` to clear a field. Unknown fields ignored. Empty
// body returns no_op.
function v256S(v: unknown, max = 200): string | null {
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

router.patch("/crm/companies/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) return res.status(400).json({ error: "id_required" });
  const b: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const cols: Array<[string, number]> = [
    ["legal_name", 200],
    ["operating_name", 200],
    ["business_number", 50],
    ["address_line1", 200],
    ["city", 100],
    ["province", 50],
    ["postal_code", 20],
    ["industry", 200],
  ];
  for (const [col, max] of cols) {
    if (b[col] === undefined) continue;
    const val = b[col] === null ? null : v256S(b[col], max);
    if (col === "legal_name" && val === null) {
      return res.status(400).json({ error: "legal_name_required" });
    }
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }

  if (sets.length === 0) {
    return res.json({ ok: true, no_op: true });
  }
  params.push(id);
  try {
    const r = await pool.query(
      `UPDATE bi_companies SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
      params,
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err, id }, "bi_crm_company_patch_failed");
    return res.status(500).json({ error: "patch_failed" });
  }
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


// BI_SERVER_BLOCK_BI_ROUND8_APOLLO_v1 -- Apollo enrichment +
// engagement payload for the BI contact drawer. The portal calls
// these via apolloMarketing.ts; they 404 today because they weren't
// implemented.

// GET /api/v1/bi/contacts/:id/marketing
// Returns the ApolloContactPayload shape the portal expects.
router.get("/contacts/:id/marketing", async (req, res) => {
  try {
    const id = String(req.params.id);
    const cr = await pool.query(
      `SELECT id, full_name, email,
              apollo_contact_id, apollo_data, apollo_stage,
              apollo_sequence_names, apollo_last_synced_at
         FROM bi_contacts
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    if (cr.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Contact not found" } });
    }
    const contact = cr.rows[0];
    const er = await pool.query(
      `SELECT id, event_type, sequence_name, occurred_at, metadata
         FROM bi_crm_engagement_events
        WHERE contact_id = $1
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [id],
    );
    return res.json({
      contact: {
        id: contact.id,
        full_name: contact.full_name,
        email: contact.email,
        apollo_contact_id: contact.apollo_contact_id,
        apollo_data: contact.apollo_data,
        apollo_stage: contact.apollo_stage,
        apollo_sequence_names: contact.apollo_sequence_names || [],
        apollo_last_synced_at: contact.apollo_last_synced_at,
      },
      events: er.rows.map((r) => ({
        id: r.id,
        event_type: r.event_type,
        sequence_name: r.sequence_name,
        occurred_at: r.occurred_at,
        metadata: r.metadata || {},
      })),
    });
  } catch (err) {
    logger.error({ err }, "bi.contacts.marketing.failed");
    return res.status(500).json({ error: { code: "internal", message: "Failed to load marketing payload" } });
  }
});

// POST /api/v1/bi/contacts/:id/enrich[?force=1]
// Triggers Apollo enrichment. Uses the existing Apollo client. The
// 24h cache rule: if apollo_last_synced_at is < 24h ago and force is
// not set, return the cached row without calling Apollo. This keeps
// us under the Apollo rate limit for batch operations on the same
// contact list.
router.post("/contacts/:id/enrich", async (req, res) => {
  try {
    const id = String(req.params.id);
    const force = String(req.query.force || "") === "1";
    const cr = await pool.query(
      `SELECT id, email, apollo_data, apollo_last_synced_at
         FROM bi_contacts
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    if (cr.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Contact not found" } });
    }
    const c = cr.rows[0];
    if (!c.email) {
      return res.status(400).json({ error: { code: "no_email", message: "Contact has no email" } });
    }
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const lastMs = c.apollo_last_synced_at ? new Date(c.apollo_last_synced_at).getTime() : 0;
    if (!force && lastMs > dayAgo && c.apollo_data) {
      return res.json({ cached: true, apollo_data: c.apollo_data });
    }

    // Call Apollo. The apolloClient is the same one biOutreachCrmRoutes
    // uses for sequence search; it has the API key + retry logic baked in.
    const { apolloClient } = await import("../services/apolloClient");
    let apolloPayload: Record<string, unknown> | null = null;
    try {
      apolloPayload = await apolloClient.enrichByEmail(c.email);
    } catch (err: any) {
      logger.warn({ err, contactId: id }, "apollo.enrich.failed");
      return res.status(502).json({
        error: { code: "apollo_failed", message: err?.message || "Apollo enrichment failed" },
      });
    }
    if (!apolloPayload) {
      return res.status(404).json({ error: { code: "no_match", message: "Apollo returned no match for that email" } });
    }

    // Extract Apollo identity + stage / sequences from the payload.
    const apolloContactId = (apolloPayload as any)?.id ?? null;
    const sequenceNames = Array.isArray((apolloPayload as any)?.contact_campaign_statuses)
      ? (apolloPayload as any).contact_campaign_statuses
          .map((s: any) => s?.emailer_campaign?.name)
          .filter(Boolean)
      : [];
    const stage = (apolloPayload as any)?.contact_stage?.name ?? null;

    await pool.query(
      `UPDATE bi_contacts
          SET apollo_contact_id     = $2,
              apollo_data           = $3::jsonb,
              apollo_stage          = $4,
              apollo_sequence_names = $5::text[],
              apollo_last_synced_at = NOW()
        WHERE id = $1`,
      [id, apolloContactId, JSON.stringify(apolloPayload), stage, sequenceNames],
    );

    return res.json({ cached: false, apollo_data: apolloPayload });
  } catch (err) {
    logger.error({ err }, "bi.contacts.enrich.failed");
    return res.status(500).json({ error: { code: "internal", message: "Enrichment failed" } });
  }
});

// GET /api/v1/bi/crm/contacts/:id/timeline
// Mirrors the BF-Server timeline fix from Block 32. Unions BI
// CRM activity (bi_contact_activity, post-v251) with comms-side
// events. Today bi_communications_messages and bi_call_logs may
// not exist in this silo (BI comms still piggybacks on BF-Server
// per the user direction), so the query gracefully returns just
// the bi_contact_activity rows when the comms tables are absent.
router.get("/crm/contacts/:id/timeline", async (req, res) => {
  try {
    const id = String(req.params.id);
    const r = await pool.query(
      `SELECT id, occurred_at, event_type, summary, metadata
         FROM bi_contact_activity
        WHERE contact_id = $1
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [id],
    );
    return res.json({ events: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.contacts.timeline.failed");
    return res.status(500).json({ error: { code: "internal", message: "Failed to load timeline" } });
  }
});


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ApolloEnrichOutcome = {
  status: number;
  body: Record<string, unknown>;
  enriched: boolean;
};

function manualFieldsSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
}

function apolloFieldValues(person: any): Record<string, unknown> {
  return {
    title: person?.title ?? null,
    organization_name: person?.organization_name ?? person?.organization?.name ?? null,
    organization_industry: person?.organization_industry ?? person?.organization?.industry ?? null,
    linkedin_url: person?.linkedin_url ?? null,
    phone_numbers: Array.isArray(person?.phone_numbers) ? person.phone_numbers : [],
    city: person?.city ?? null,
    state: person?.state ?? null,
    country: person?.country ?? null,
  };
}

async function enrichContactById(id: string): Promise<ApolloEnrichOutcome> {
  const cr = await pool.query<{ id: string; email: string | null; manually_edited_fields: unknown }>(
    `SELECT id, email, manually_edited_fields
       FROM bi_contacts
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  if (!cr.rows[0]) return { status: 404, body: { error: "not_found" }, enriched: false };
  const contact = cr.rows[0];
  if (!contact.email) return { status: 400, body: { error: "contact_has_no_email" }, enriched: false };

  let person: any = null;
  try {
    const apollo = await matchPerson({ email: contact.email });
    person = apollo.person;
  } catch (err) {
    if (err instanceof ApolloError && (err.status === 401 || err.status === 403)) {
      logger.error({ status: err.status, body: err.body, contactId: id }, "apollo_enrich_unauthorized");
      return {
        status: 422,
        body: { error: "apollo_unauthorized", message: "Verify Apollo API key in BI-Server env" },
        enriched: false,
      };
    }
    logger.error({ err, contactId: id }, "apollo_enrich_request_failed");
    return { status: 502, body: { error: "apollo_enrich_failed" }, enriched: false };
  }

  if (!person) {
    await pool.query(`UPDATE bi_contacts SET last_enriched_at = NOW() WHERE id = $1`, [id]);
    return { status: 404, body: { error: "apollo_no_match" }, enriched: false };
  }

  const manual = manualFieldsSet(contact.manually_edited_fields);
  const values = apolloFieldValues(person);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const changedFields: string[] = [];
  let i = 2;

  for (const [field, value] of Object.entries(values)) {
    if (manual.has(field)) continue;
    if (field === "phone_numbers") {
      sets.push(`${field} = $${i++}::jsonb`);
      params.push(JSON.stringify(value));
    } else {
      sets.push(`${field} = $${i++}`);
      params.push(value);
    }
    changedFields.push(field);
  }
  sets.push(`last_enriched_at = NOW()`);

  await pool.query(`UPDATE bi_contacts SET ${sets.join(", ")} WHERE id = $1`, params);
  await pool.query(
    `INSERT INTO bi_contact_activity (contact_id, kind, payload)
     VALUES ($1, 'enriched', $2::jsonb)`,
    [id, JSON.stringify({ changed_fields: changedFields })],
  );

  return { status: 200, body: { ok: true, changed_fields: changedFields }, enriched: true };
}


router.post("/crm/contacts/:id/enrich", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id_required" });
  const result = await enrichContactById(id);
  return res.status(result.status).json(result.body);
});

router.post("/crm/contacts/bulk-enrich", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids = Array.isArray(req.body?.contact_ids) ? req.body.contact_ids.filter((id: unknown): id is string => typeof id === "string") : [];
  let enriched = 0;
  let failed = 0;
  const errors: Array<{ contact_id: string; status: number; error: unknown }> = [];

  for (let idx = 0; idx < ids.length; idx += 1) {
    const id = ids[idx];
    const result = await enrichContactById(id);
    if (result.enriched) {
      enriched += 1;
    } else {
      failed += 1;
      errors.push({ contact_id: id, status: result.status, error: result.body });
    }
    if (idx < ids.length - 1) await sleep(200);
  }

  return res.json({ enriched, failed, errors });
});

router.post("/crm/contacts/bulk-update", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids: string[] = Array.isArray(req.body?.contact_ids) ? req.body.contact_ids : [];
  const set = req.body?.set ?? {};
  await pool.query(`UPDATE bi_contacts SET outreach_stage = COALESCE($1,outreach_stage), owner_user_id = COALESCE($2,owner_user_id), tags = COALESCE(array(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || $3::text[])), tags) WHERE id = ANY($4::uuid[])`, [set.outreach_stage ?? null, set.owner_user_id ?? null, Array.isArray(set.add_tags) ? set.add_tags : [], ids]);
  return res.json({ ok: true, updated: ids.length });
});

router.get("/crm/contacts/:id/activity", async (req, res) => {
  const r = await pool.query(`SELECT a.*, p.email AS actor_email FROM bi_contact_activity a LEFT JOIN bi_staff_profile p ON p.staff_user_id = a.actor_user_id WHERE a.contact_id = $1 ORDER BY occurred_at DESC`, [req.params.id]);
  return res.json({ items: r.rows });
});

router.post("/crm/contacts/bulk-delete", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids_required" });
  await pool.query(`DELETE FROM bi_contacts WHERE id = ANY($1::uuid[])`, [ids]);
  return res.json({ ok: true, deleted: ids.length });
});

router.post("/crm/contacts/bulk-tag", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  const tag = typeof req.body?.tag === "string" ? req.body.tag.trim() : "";
  if (ids.length === 0 || !tag) return res.status(400).json({ error: "ids_and_tag_required" });
  await pool.query(`UPDATE bi_contacts SET tags = array(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || $1::text[])) WHERE id = ANY($2::uuid[])`, [[tag], ids]);
  return res.json({ ok: true, tagged: ids.length });
});

router.post("/crm/companies/bulk-delete", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids_required" });
  await pool.query(`DELETE FROM bi_companies WHERE id = ANY($1::uuid[])`, [ids]);
  return res.json({ ok: true, deleted: ids.length });
});

router.post("/crm/companies/bulk-tag", async (req, res) => {
  if (!hasCapability((req as any).user, "marketing:outreach")) return res.status(403).json({ error: "forbidden" });
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  const tag = typeof req.body?.tag === "string" ? req.body.tag.trim() : "";
  if (ids.length === 0 || !tag) return res.status(400).json({ error: "ids_and_tag_required" });
  await pool.query(`UPDATE bi_companies SET tags = array(SELECT DISTINCT unnest(COALESCE(tags,'{}'::text[]) || $1::text[])) WHERE id = ANY($2::uuid[])`, [[tag], ids]);
  return res.json({ ok: true, tagged: ids.length });
});

export default router;
