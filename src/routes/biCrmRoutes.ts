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
