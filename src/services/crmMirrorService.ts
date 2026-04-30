// BI_PGI_ALIGNMENT_v56 — auto-mirror lender/referrer/applicant entities into
// bi_contacts (and bi_companies) with accumulating tags + mutating lifecycle_stage.
import { pool } from "../db";
import { logger } from "../platform/logger";

export type MirrorSource = "lender" | "lender_contact" | "referrer" | "referral" | "applicant";
async function ensureCompany(name: string | null | undefined): Promise<string | null> { if (!name || !name.trim()) return null; const found = await pool.query<{ id: string }>(`SELECT id FROM bi_companies WHERE LOWER(legal_name) = LOWER($1) LIMIT 1`, [name.trim()]); if (found.rows[0]) return found.rows[0].id; const ins = await pool.query<{ id: string }>(`INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`, [name.trim()]); return ins.rows[0]?.id ?? null; }
export type MirrorInput = { source: MirrorSource; full_name: string; email?: string | null; phone_e164?: string | null; company_name?: string | null; lifecycle_stage?: string; extra_tags?: string[]; };
const LIFECYCLE_BY_SOURCE: Record<MirrorSource, string> = { lender: "partner", lender_contact: "partner", referrer: "partner", referral: "lead", applicant: "applicant" };
export async function mirrorToContact(input: MirrorInput): Promise<{ contact_id: string; created: boolean }> {
  const companyId = await ensureCompany(input.company_name); const lifecycle = input.lifecycle_stage ?? LIFECYCLE_BY_SOURCE[input.source]; const tagsToAdd = [input.source, ...(input.extra_tags ?? [])]; const email = input.email?.toLowerCase().trim() || null; const phone = input.phone_e164?.trim() || null;
  let existing: { id: string } | undefined; if (email) existing = (await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE LOWER(email) = $1 LIMIT 1`, [email])).rows[0]; if (!existing && phone) existing = (await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE phone_e164 = $1 LIMIT 1`, [phone])).rows[0];
  if (existing) { await pool.query(`UPDATE bi_contacts SET full_name = COALESCE(NULLIF($2, ''), full_name), email = COALESCE($3, email), phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id), tags = ARRAY(SELECT DISTINCT UNNEST(tags || $6::text[])), lifecycle_stage = $7 WHERE id = $1`, [existing.id, input.full_name, email, phone, companyId, tagsToAdd, lifecycle]); return { contact_id: existing.id, created: false }; }
  const ins = await pool.query<{ id: string }>(`INSERT INTO bi_contacts (full_name, email, phone_e164, company_id, tags, lifecycle_stage, source_first) VALUES ($1, $2, $3, $4, $5::text[], $6, $7) RETURNING id`, [input.full_name, email, phone, companyId, tagsToAdd, lifecycle, input.source]); logger.info({ source: input.source, contact_id: ins.rows[0]?.id }, "mirrored to bi_contacts"); return { contact_id: ins.rows[0]!.id, created: true };
}
