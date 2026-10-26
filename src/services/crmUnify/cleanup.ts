// BI_SERVER_v856_CRM_UNIFY - "Clean up data" for the BI CRM (same as BF-Server v856): scan, review, apply, undo.
// Nothing changes until staff tick the changes; every applied value keeps a before-image for undo.
import type { PoolClient } from "pg";
import type { Q } from "./tags";
import { proposeCompanyFixes, proposeContactFixes } from "./textClean";
import { logger } from "../../platform/logger";

export const CONTACT_CLEAN_FIELDS = ["full_name", "first_name", "last_name", "email", "phone_e164", "title"];
export const COMPANY_CLEAN_FIELDS = ["legal_name", "operating_name", "email", "phone", "website", "domain", "industry", "city"];

export type CleanupChange = { entity: "contact" | "company"; entityId: string; record: string; field: string; before: string; after: string; reason: string };

// The shared text rules use BF column names; map them to BI's.
const CONTACT_TO_BI: Record<string, string> = { name: "full_name", first_name: "first_name", last_name: "last_name", email: "email", phone: "phone_e164", job_title: "title" };
const COMPANY_TO_BI: Record<string, string> = { name: "legal_name", dba_name: "operating_name", email: "email", phone: "phone", website: "website", domain: "domain", industry: "industry", city: "city" };

export async function scanCleanup(db: Q, entity: "contact" | "company", limit = 2000): Promise<CleanupChange[]> {
  const out: CleanupChange[] = [];
  if (entity === "contact") {
    const r = await db.query(
      `SELECT c.id::text AS id, c.full_name, c.first_name, c.last_name, c.email, c.phone_e164, c.title,
              (SELECT a.first_name FROM bi_applications a WHERE a.primary_contact_id = c.id ORDER BY a.updated_at DESC NULLS LAST LIMIT 1) AS app_first,
              (SELECT a.last_name FROM bi_applications a WHERE a.primary_contact_id = c.id ORDER BY a.updated_at DESC NULLS LAST LIMIT 1) AS app_last
         FROM bi_contacts c
        WHERE c.converted_to_company_id IS NULL
        ORDER BY c.created_at DESC
        LIMIT 20000`,
    );
    for (const row of r.rows) {
      const shaped = { name: row.full_name, first_name: row.first_name, last_name: row.last_name, email: row.email, phone: row.phone_e164, job_title: row.title };
      const known = row.app_first || row.app_last ? { first: row.app_first, last: row.app_last } : null;
      for (const p of proposeContactFixes(shaped, known)) {
        const field = CONTACT_TO_BI[p.field];
        if (!field) continue;
        out.push({ entity, entityId: String(row.id), record: String(row.full_name ?? row.email ?? row.id), ...p, field });
        if (out.length >= limit) return out;
      }
    }
  } else {
    const r = await db.query(`SELECT id::text AS id, legal_name, operating_name, email, phone, website, domain, industry, city FROM bi_companies ORDER BY created_at DESC LIMIT 20000`);
    for (const row of r.rows) {
      const shaped = { name: row.legal_name, dba_name: row.operating_name, email: row.email, phone: row.phone, website: row.website, domain: row.domain, industry: row.industry, city: row.city };
      for (const p of proposeCompanyFixes(shaped)) {
        const field = COMPANY_TO_BI[p.field];
        if (!field) continue;
        out.push({ entity, entityId: String(row.id), record: String(row.legal_name ?? row.id), ...p, field });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export function validChange(c: any): c is CleanupChange {
  if (!c || (c.entity !== "contact" && c.entity !== "company")) return false;
  if (typeof c.entityId !== "string" || !/^[0-9a-f-]{36}$/i.test(c.entityId)) return false;
  const allowed = c.entity === "contact" ? CONTACT_CLEAN_FIELDS : COMPANY_CLEAN_FIELDS;
  if (!allowed.includes(c.field)) return false;
  return typeof c.after === "string" && typeof c.before === "string" && c.after.length <= 500;
}

export async function applyCleanup(client: PoolClient, changes: CleanupChange[], userId: string | null) {
  const batch = (await client.query(`INSERT INTO bi_crm_cleanup_batches (created_by) VALUES ($1) RETURNING id::text AS id`, [userId])).rows[0].id as string;
  let applied = 0;
  const skipped: Array<{ entityId: string; field: string; why: string }> = [];
  for (const c of changes) {
    const table = c.entity === "contact" ? "bi_contacts" : "bi_companies";
    await client.query("SAVEPOINT bi_crm_cleanup_change");
    let r;
    try {
      r = await client.query(
        `UPDATE ${table} SET "${c.field}" = $1, updated_at = now() WHERE id = $2::uuid AND "${c.field}" IS NOT DISTINCT FROM $3::text RETURNING id`,
        [c.after, c.entityId, c.before],
      );
      await client.query("RELEASE SAVEPOINT bi_crm_cleanup_change");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT bi_crm_cleanup_change");
      logger.warn({ err, entityId: c.entityId, field: c.field }, "bi_crm_cleanup_change_skipped");
      skipped.push({ entityId: c.entityId, field: c.field, why: "clashes with another record" });
      continue;
    }
    if (!r.rowCount) { skipped.push({ entityId: c.entityId, field: c.field, why: "changed since the scan" }); continue; }
    await client.query(
      `INSERT INTO bi_crm_cleanup_changes (batch_id, entity, entity_id, field, before_value, after_value, reason) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7)`,
      [batch, c.entity, c.entityId, c.field, c.before, c.after, String(c.reason ?? "").slice(0, 200)],
    );
    applied++;
  }
  await client.query(`UPDATE bi_crm_cleanup_batches SET change_count = $2 WHERE id = $1::uuid`, [batch, applied]);
  return { batchId: batch, applied, skipped };
}

export async function undoCleanup(client: PoolClient, batchId: string, userId: string | null) {
  const b = (await client.query(`SELECT id, undone_at FROM bi_crm_cleanup_batches WHERE id = $1::uuid FOR UPDATE`, [batchId])).rows[0];
  if (!b) return { ok: false as const, status: 404, error: "not_found" };
  if (b.undone_at) return { ok: false as const, status: 409, error: "already_undone" };
  const rows = (await client.query(`SELECT entity, entity_id::text AS entity_id, field, before_value, after_value FROM bi_crm_cleanup_changes WHERE batch_id = $1::uuid`, [batchId])).rows;
  let restored = 0;
  const skipped: Array<{ entityId: string; field: string }> = [];
  for (const c of rows) {
    const allowed = c.entity === "contact" ? CONTACT_CLEAN_FIELDS : COMPANY_CLEAN_FIELDS;
    if (!allowed.includes(c.field)) continue;
    const table = c.entity === "contact" ? "bi_contacts" : "bi_companies";
    const r = await client.query(
      `UPDATE ${table} SET "${c.field}" = $1, updated_at = now() WHERE id = $2::uuid AND "${c.field}" IS NOT DISTINCT FROM $3::text RETURNING id`,
      [c.before_value, c.entity_id, c.after_value],
    );
    if (r.rowCount) restored++; else skipped.push({ entityId: c.entity_id, field: c.field });
  }
  await client.query(`UPDATE bi_crm_cleanup_batches SET undone_at = now(), undone_by = $2 WHERE id = $1::uuid`, [batchId, userId]);
  return { ok: true as const, restored, skipped };
}

export async function listBatches(db: Q) {
  const r = await db.query(`SELECT id::text AS id, created_at, change_count, undone_at, created_by AS created_by_name FROM bi_crm_cleanup_batches ORDER BY created_at DESC LIMIT 25`);
  return r.rows;
}
