import { pool } from "../../db";
import { logger } from "../../platform/logger";
import { isContactSuppressed } from "../../services/biCrmSuppression";
import type { ApolloPerson } from "./apolloClient";

export type UpsertedContact = {
  contact_id: string | null;
  company_id?: string | null;
  created: boolean;
  apollo_contact_id: string;
  kind?: "contact" | "company" | "ambiguous" | "suppressed";
};

function safeEmail(p: ApolloPerson): string | null { return p.email ? p.email.toLowerCase().trim() : null; }
function fullName(p: ApolloPerson): string { return p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown"); }
function hasFullPersonName(p: ApolloPerson): boolean { return Boolean(p.first_name?.trim() && p.last_name?.trim()); }
function emailLocalPart(email: string): string { return email.split("@")[0] || email; }
function primaryPhone(p: ApolloPerson): string | null { const first = p.phone_numbers?.[0]; return first?.sanitized_number ?? first?.raw_number ?? null; }
function sequenceNames(p: ApolloPerson): string[] { const names = (p as Record<string, unknown>).current_sequence_names; return Array.isArray(names) ? names.filter((x): x is string => typeof x === "string") : []; }

async function findCompanyId(p: ApolloPerson, fallbackName?: string | null): Promise<string | null> {
  const orgName = p.organization?.name ?? fallbackName;
  if (!orgName) return null;
  const r = await pool.query<{ id: string }>(`SELECT id FROM bi_companies WHERE LOWER(legal_name) = LOWER($1) OR LOWER(operating_name) = LOWER($1) LIMIT 1`, [orgName]);
  if (r.rows[0]) return r.rows[0].id;
  const ins = await pool.query<{ id: string }>(`INSERT INTO bi_companies (legal_name, industry) VALUES ($1, $2) RETURNING id`, [orgName, p.organization?.industry ?? null]);
  return ins.rows[0]?.id ?? null;
}

export async function upsertApolloContact(p: ApolloPerson, opts: { sourceLabelId?: string | null } = {}): Promise<UpsertedContact> {
  // BI_SERVER_BLOCK_58_APOLLO_LIST_IMPORT_v1
  const email = safeEmail(p);
  const isPerson = hasFullPersonName(p);
  const hasOrganization = Boolean(p.organization?.name);
  const ambiguous = Boolean(email && !isPerson);
  const name = isPerson ? fullName(p) : (ambiguous && email ? emailLocalPart(email) : fullName(p));
  const phone = primaryPhone(p);
  const seqs = sequenceNames(p);
  const stage = p.contact_stage?.name ?? null;
  const companyId = await findCompanyId(p, ambiguous && email ? emailLocalPart(email) : null);
  const labelId = opts.sourceLabelId ?? null;

  if (!isPerson && hasOrganization && !ambiguous) {
    logger.info({ apollo_id: p.id, company_id: companyId }, "Apollo organization imported as company");
    return { contact_id: null, company_id: companyId, created: Boolean(companyId), apollo_contact_id: p.id, kind: "company" };
  }

  const byId = await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE apollo_contact_id = $1 LIMIT 1`, [p.id]);
  if (byId.rows[0]) {
    await pool.query(`UPDATE bi_contacts SET full_name = $2, email = COALESCE($3, email), phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id), apollo_data = $6::jsonb, apollo_stage = $7, apollo_sequence_names = $8::text[], apollo_last_synced_at = NOW() WHERE id = $1`, [byId.rows[0].id, name, email, phone, companyId, JSON.stringify(p), stage, seqs]);
    if (labelId) await pool.query(`UPDATE bi_contacts SET apollo_label_ids = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(apollo_label_ids, ARRAY[]::text[]) || ARRAY[$2]::text[]))) WHERE id = $1`, [byId.rows[0].id, labelId]);
    return { contact_id: byId.rows[0].id, company_id: companyId, created: false, apollo_contact_id: p.id, kind: ambiguous ? "ambiguous" : "contact" };
  }

  if (email) {
    const byEmail = await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE LOWER(email) = $1 LIMIT 1`, [email]);
    if (byEmail.rows[0]) {
      await pool.query(`UPDATE bi_contacts SET apollo_contact_id = $2, full_name = $3, phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id), apollo_data = $6::jsonb, apollo_stage = $7, apollo_sequence_names = $8::text[], apollo_last_synced_at = NOW() WHERE id = $1`, [byEmail.rows[0].id, p.id, name, phone, companyId, JSON.stringify(p), stage, seqs]);
      return { contact_id: byEmail.rows[0].id, company_id: companyId, created: false, apollo_contact_id: p.id, kind: ambiguous ? "ambiguous" : "contact" };
    }
  }

  // BI_SERVER_BLOCK_v842_APOLLO_SUPPRESSION_AND_NAME — never resurrect a contact
  // that was deleted from the CRM (suppression list). This was the cause of
  // "deleted contacts keep coming back" after the Apollo sync was enabled.
  if (await isContactSuppressed(pool, email, phone)) {
    logger.info({ apollo_id: p.id, email }, "Apollo contact skipped (suppressed)");
    return { contact_id: null, company_id: companyId, created: false, apollo_contact_id: p.id, kind: "suppressed" };
  }

  const ins = await pool.query<{ id: string }>(`INSERT INTO bi_contacts (company_id, full_name, email, phone_e164, apollo_contact_id, apollo_data, apollo_stage, apollo_sequence_names, apollo_last_synced_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::text[], NOW()) RETURNING id`, [companyId, name, email, phone, p.id, JSON.stringify(p), stage, seqs]);
  logger.info({ apollo_id: p.id, contact_id: ins.rows[0]?.id }, "Apollo contact upserted");
  return { contact_id: ins.rows[0]!.id, company_id: companyId, created: true, apollo_contact_id: p.id, kind: ambiguous ? "ambiguous" : "contact" };
}
