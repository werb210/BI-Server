import { pool } from "../../db";
import { logger } from "../../platform/logger";
import { matchPerson } from "./apolloClient";
import { upsertApolloContact } from "./apolloContactSync";
const CACHE_TTL_DAYS = 90;
export async function enrichContact(contactId: string, opts: { force?: boolean } = {}): Promise<{ cached: boolean; apollo_data: unknown | null; apollo_contact_id: string | null; }> {
  const r = await pool.query<{ id: string; email: string | null; full_name: string; apollo_contact_id: string | null; apollo_data: unknown; apollo_last_synced_at: Date | null; }>(`SELECT id, email, full_name, apollo_contact_id, apollo_data, apollo_last_synced_at FROM bi_contacts WHERE id = $1 LIMIT 1`, [contactId]);
  const row = r.rows[0];
  if (!row) throw new Error("contact not found");
  if (!opts.force && row.apollo_last_synced_at) {
    const ageMs = Date.now() - row.apollo_last_synced_at.getTime();
    if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) return { cached: true, apollo_data: row.apollo_data, apollo_contact_id: row.apollo_contact_id };
  }
  if (!process.env.APOLLO_API_KEY) { logger.warn({ contactId }, "Apollo enrichment skipped — APOLLO_API_KEY not configured"); return { cached: false, apollo_data: row.apollo_data, apollo_contact_id: row.apollo_contact_id }; }
  if (!row.email) return { cached: false, apollo_data: row.apollo_data, apollo_contact_id: row.apollo_contact_id };
  const [first, ...rest] = row.full_name.split(/\s+/); const last = rest.join(" ") || undefined;
  try {
    const { person } = await matchPerson({ email: row.email, first_name: first, last_name: last, reveal_personal_emails: false });
    if (!person) { await pool.query(`UPDATE bi_contacts SET apollo_last_synced_at = NOW() WHERE id = $1`, [contactId]); return { cached: false, apollo_data: null, apollo_contact_id: null }; }
    const upserted = await upsertApolloContact(person);
    const fresh = await pool.query<{ apollo_data: unknown }>(`SELECT apollo_data FROM bi_contacts WHERE id = $1`, [upserted.contact_id]);
    return { cached: false, apollo_data: fresh.rows[0]?.apollo_data ?? person, apollo_contact_id: upserted.apollo_contact_id };
  } catch (err) { logger.error({ err, contactId }, "Apollo enrichment failed"); return { cached: false, apollo_data: row.apollo_data, apollo_contact_id: row.apollo_contact_id }; }
}
