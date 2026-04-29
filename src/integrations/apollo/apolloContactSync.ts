import { pool } from "../../db";
import { logger } from "../../platform/logger";
import type { ApolloPerson } from "./apolloClient";

export type UpsertedContact = {
  contact_id: string;
  created: boolean;
  apollo_contact_id: string;
};

function safeEmail(p: ApolloPerson): string | null { return p.email ? p.email.toLowerCase().trim() : null; }
function fullName(p: ApolloPerson): string { return p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown"); }
function primaryPhone(p: ApolloPerson): string | null { const first = p.phone_numbers?.[0]; return first?.sanitized_number ?? first?.raw_number ?? null; }
function sequenceNames(p: ApolloPerson): string[] { const names = (p as Record<string, unknown>).current_sequence_names; return Array.isArray(names) ? names.filter((x): x is string => typeof x === "string") : []; }

async function findCompanyId(p: ApolloPerson): Promise<string | null> {
  const orgName = p.organization?.name;
  if (!orgName) return null;
  const r = await pool.query<{ id: string }>(`SELECT id FROM bi_companies WHERE LOWER(legal_name) = LOWER($1) OR LOWER(operating_name) = LOWER($1) LIMIT 1`, [orgName]);
  if (r.rows[0]) return r.rows[0].id;
  const ins = await pool.query<{ id: string }>(`INSERT INTO bi_companies (legal_name, industry) VALUES ($1, $2) RETURNING id`, [orgName, p.organization?.industry ?? null]);
  return ins.rows[0]?.id ?? null;
}

export async function upsertApolloContact(p: ApolloPerson): Promise<UpsertedContact> {
  const email = safeEmail(p);
  const name = fullName(p);
  const phone = primaryPhone(p);
  const seqs = sequenceNames(p);
  const stage = p.contact_stage?.name ?? null;
  const companyId = await findCompanyId(p);

  const byId = await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE apollo_contact_id = $1 LIMIT 1`, [p.id]);
  if (byId.rows[0]) {
    await pool.query(`UPDATE bi_contacts SET full_name = $2, email = COALESCE($3, email), phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id), apollo_data = $6::jsonb, apollo_stage = $7, apollo_sequence_names = $8::text[], apollo_last_synced_at = NOW() WHERE id = $1`, [byId.rows[0].id, name, email, phone, companyId, JSON.stringify(p), stage, seqs]);
    return { contact_id: byId.rows[0].id, created: false, apollo_contact_id: p.id };
  }

  if (email) {
    const byEmail = await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE LOWER(email) = $1 LIMIT 1`, [email]);
    if (byEmail.rows[0]) {
      await pool.query(`UPDATE bi_contacts SET apollo_contact_id = $2, full_name = $3, phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id), apollo_data = $6::jsonb, apollo_stage = $7, apollo_sequence_names = $8::text[], apollo_last_synced_at = NOW() WHERE id = $1`, [byEmail.rows[0].id, p.id, name, phone, companyId, JSON.stringify(p), stage, seqs]);
      return { contact_id: byEmail.rows[0].id, created: false, apollo_contact_id: p.id };
    }
  }

  const ins = await pool.query<{ id: string }>(`INSERT INTO bi_contacts (company_id, full_name, email, phone_e164, apollo_contact_id, apollo_data, apollo_stage, apollo_sequence_names, apollo_last_synced_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::text[], NOW()) RETURNING id`, [companyId, name, email, phone, p.id, JSON.stringify(p), stage, seqs]);
  logger.info({ apollo_id: p.id, contact_id: ins.rows[0]?.id }, "Apollo contact upserted");
  return { contact_id: ins.rows[0]!.id, created: true, apollo_contact_id: p.id };
}
