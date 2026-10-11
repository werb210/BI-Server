// BI_SERVER_v789_CONTACT_MERGE [90] - duplicate detection, merge and the
// documents tab on a CRM contact. Mounted at /api/v1/bi behind requireAuth;
// staff only (service tokens 403). Guards are per route, not router.use: this
// router sits on the shared "/api/v1/bi" prefix.
//
//   GET  /crm/contacts/:id/duplicates -> { ok, duplicates: [{ ..., matched_on: ["phone"|"email"] }] }
//        other contacts sharing the last 10 phone digits or lower(trim(email));
//        empty values never match.
//   POST /crm/contacts/:id/merge { duplicate_id } -> { ok, id, merged_id, moved: { table: rows } }
//        one transaction: every row referencing the duplicate moves to :id,
//        empty fields on :id are filled from the duplicate, tags are unioned,
//        then the duplicate is deleted.
//   GET  /crm/contacts/:id/documents -> { ok, documents: [...] } newest first,
//        for every application linked to the contact (bi_applications.primary_contact_id
//        or a bi_activity row with this contact_id).
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { logHiddenError } from "../platform/safeError";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { crmActorFrom } from "../lib/crmActivityInput";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SQL for "last 10 digits of a phone" and "normalised email" on a bi_contacts alias.
const P10 = (alias: string) => `right(regexp_replace(COALESCE(${alias}.phone_e164, ''), '\\D', '', 'g'), 10)`;
const EM = (alias: string) => `lower(trim(COALESCE(${alias}.email, '')))`;

router.get("/crm/contacts/:id/duplicates", requireStaffUser, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const t = await pool.query<{ p10: string; em: string }>(
      `SELECT ${P10("t")} AS p10, ${EM("t")} AS em FROM bi_contacts t WHERE t.id = $1 LIMIT 1`,
      [id],
    );
    const target = t.rows[0];
    if (!target) return res.status(404).json({ ok: false, error: "not_found" });
    const p10 = target.p10 && target.p10.length === 10 ? target.p10 : null;
    const em = target.em ? target.em : null;
    if (!p10 && !em) return res.json({ ok: true, duplicates: [] });
    const r = await pool.query(
      `SELECT c.id, c.full_name, c.email, c.phone_e164, c.company_id,
              co.legal_name AS company_name, c.outreach_status, c.created_at,
              ($2::text IS NOT NULL AND ${P10("c")} = $2::text) AS phone_match,
              ($3::text IS NOT NULL AND ${EM("c")} = $3::text) AS email_match
         FROM bi_contacts c
         LEFT JOIN bi_companies co ON co.id = c.company_id
        WHERE c.id <> $1
          AND (($2::text IS NOT NULL AND ${P10("c")} = $2::text)
            OR ($3::text IS NOT NULL AND ${EM("c")} = $3::text))
        ORDER BY c.created_at DESC
        LIMIT 50`,
      [id, p10, em],
    );
    const duplicates = r.rows.map((row: Record<string, unknown>) => {
      const { phone_match, email_match, ...rest } = row;
      const matched_on: string[] = [];
      if (phone_match) matched_on.push("phone");
      if (email_match) matched_on.push("email");
      return { ...rest, matched_on };
    });
    return res.json({ ok: true, duplicates });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "duplicates_failed", requestId: logHiddenError(req, err, "contact_duplicates_failed") });
  }
});

// Columns that point at bi_contacts(id) with no unique constraint involving them.
const PLAIN_REFS: Array<[table: string, column: string]> = [
  ["bi_contact_activity", "contact_id"],
  ["bi_crm_engagement_events", "contact_id"],
  ["bi_marketing_replies", "contact_id"],
  ["bi_suppressions", "contact_id"],
  ["bi_activity", "contact_id"], // no FK, still a link to the contact
  ["bi_applications", "primary_contact_id"],
];
// TEXT contact_id columns (no FK): the SendGrid events ledger and link clicks.
const TEXT_REFS = ["bi_marketing_send_events", "bi_email_link_clicks"];
// Tables with a unique key that includes contact_id: move only the rows the
// keeper does not already have, then drop the duplicate's conflicting leftovers.
const UNIQUE_REFS: Array<[table: string, otherKey: string | null]> = [
  ["bi_apollo_enrichment", null], // PRIMARY KEY (contact_id)
  ["bi_apollo_enrollment", "sequence_id"], // UNIQUE (contact_id, sequence_id)
  ["bi_marketing_send_recipients", "job_id"], // UNIQUE (job_id, contact_id)
  ["bi_sequence_enrollments", "sequence_id"], // UNIQUE (sequence_id, contact_id)
];

// Text fields filled on the keeper when empty there and present on the duplicate.
const FILL_TEXT = [
  "full_name", "email", "phone_e164", "title", "first_name", "last_name", "linkedin_url",
  "city", "state", "country", "industry", "organization_name", "organization_industry",
  "notes", "outreach_owner_id", "outreach_status", "outreach_segment", "icp_segment",
  "source_first", "apollo_contact_id",
];

router.post("/crm/contacts/:id/merge", requireStaffUser, async (req: Request, res: Response) => {
  const keepId = String(req.params.id ?? "");
  const dupId = typeof req.body?.duplicate_id === "string" ? req.body.duplicate_id.trim() : "";
  if (!UUID_RE.test(keepId) || !UUID_RE.test(dupId)) return res.status(400).json({ ok: false, error: "invalid_id" });
  if (keepId.toLowerCase() === dupId.toLowerCase()) return res.status(400).json({ ok: false, error: "same_contact" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock both rows in a stable order so two merges of the same pair cannot deadlock.
    const both = await client.query<Record<string, unknown> & { id: string }>(
      `SELECT * FROM bi_contacts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[keepId, dupId]],
    );
    const keeper = both.rows.find((r) => String(r.id).toLowerCase() === keepId.toLowerCase());
    const dup = both.rows.find((r) => String(r.id).toLowerCase() === dupId.toLowerCase());
    if (!keeper || !dup) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: keeper ? "duplicate_not_found" : "not_found" });
    }

    const moved: Record<string, number> = {};
    for (const [table, column] of PLAIN_REFS) {
      const r = await client.query(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [keepId, dupId]);
      moved[`${table}.${column}`] = r.rowCount ?? 0;
    }
    for (const table of TEXT_REFS) {
      const r = await client.query(`UPDATE ${table} SET contact_id = $1::text WHERE contact_id = $2::text`, [keepId, dupId]);
      moved[`${table}.contact_id`] = r.rowCount ?? 0;
    }
    for (const [table, otherKey] of UNIQUE_REFS) {
      const sameKey = otherKey ? ` AND y.${otherKey} = x.${otherKey}` : "";
      const r = await client.query(
        `UPDATE ${table} AS x SET contact_id = $1
          WHERE x.contact_id = $2
            AND NOT EXISTS (SELECT 1 FROM ${table} y WHERE y.contact_id = $1${sameKey})`,
        [keepId, dupId],
      );
      moved[`${table}.contact_id`] = r.rowCount ?? 0;
      await client.query(`DELETE FROM ${table} WHERE contact_id = $1`, [dupId]);
    }

    // Delete the duplicate before filling the keeper: email and apollo_contact_id
    // are unique on bi_contacts, so the keeper can only take them once the
    // duplicate is gone. The duplicate's values travel as a JSON parameter.
    await client.query(`DELETE FROM bi_contacts WHERE id = $1`, [dupId]);

    const fills = FILL_TEXT.map(
      (col) => col === "full_name"
        ? `full_name = COALESCE(NULLIF(k.full_name, ''), NULLIF(d.v->>'full_name', ''), k.full_name)`
        : `${col} = COALESCE(NULLIF(k.${col}, ''), NULLIF(d.v->>'${col}', ''))`,
    );
    await client.query(
      `UPDATE bi_contacts AS k
          SET ${fills.join(",\n              ")},
              company_id = COALESCE(k.company_id, NULLIF(d.v->>'company_id', '')::uuid),
              tags = ARRAY(
                SELECT DISTINCT tag
                  FROM unnest(COALESCE(k.tags, '{}'::text[])
                              || ARRAY(SELECT jsonb_array_elements_text(
                                         CASE WHEN jsonb_typeof(d.v->'tags') = 'array' THEN d.v->'tags' ELSE '[]'::jsonb END))) AS tag
                 WHERE tag IS NOT NULL AND tag <> ''
              ),
              marketing_consent_at = CASE WHEN k.marketing_consent_basis IS NULL THEN (d.v->>'marketing_consent_at')::timestamptz ELSE k.marketing_consent_at END,
              marketing_consent_source = CASE WHEN k.marketing_consent_basis IS NULL THEN d.v->>'marketing_consent_source' ELSE k.marketing_consent_source END,
              marketing_consent_expires_at = CASE WHEN k.marketing_consent_basis IS NULL THEN (d.v->>'marketing_consent_expires_at')::timestamptz ELSE k.marketing_consent_expires_at END,
              marketing_consent_basis = COALESCE(k.marketing_consent_basis, d.v->>'marketing_consent_basis'),
              updated_at = now()
         FROM (SELECT $2::jsonb AS v) AS d
        WHERE k.id = $1`,
      [keepId, JSON.stringify(dup)],
    );

    const actor = crmActorFrom(req);
    const dupLabel = String(dup.full_name || dup.email || dup.phone_e164 || dupId);
    await client.query(
      `INSERT INTO bi_contact_activity (contact_id, actor_id, actor_name, event_type, body, meta)
       VALUES ($1, $2, $3, 'note', $4, $5::jsonb)`,
      [keepId, actor.id, actor.name, `Merged duplicate contact ${dupLabel}`.slice(0, 8000), JSON.stringify({ kind: "merge", merged_contact_id: dupId, moved })],
    );

    await client.query("COMMIT");
    logger.info({ keepId, dupId, moved, actor: actor.id }, "bi_crm_contact_merged");
    return res.json({ ok: true, id: keepId, merged_id: dupId, moved });
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr: unknown) => {
      logger.warn({ err: rbErr }, "bi_crm_contact_merge_rollback_failed");
    });
    return res.status(500).json({ ok: false, error: "merge_failed", requestId: logHiddenError(req, err, "contact_merge_failed") });
  } finally {
    client.release();
  }
});

router.get("/crm/contacts/:id/documents", requireStaffUser, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const c = await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1 LIMIT 1`, [id]);
    if (!c.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
    const r = await pool.query(
      `SELECT d.id, d.application_id, d.doc_type, d.original_filename, d.mime_type,
              d.bytes, d.review_status, d.created_at
         FROM bi_documents d
        WHERE d.purged_at IS NULL
          AND d.application_id IN (
                SELECT a.id FROM bi_applications a WHERE a.primary_contact_id = $1
                UNION
                SELECT act.application_id FROM bi_activity act
                 WHERE act.contact_id = $1 AND act.application_id IS NOT NULL
              )
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT 500`,
      [id],
    );
    return res.json({ ok: true, documents: r.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "documents_failed", requestId: logHiddenError(req, err, "contact_documents_failed") });
  }
});

export default router;
