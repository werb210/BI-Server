// BI_SERVER_v856_CRM_UNIFY - every person on a BI application becomes a CRM contact (same rules as BF-Server v856):
//   applicant            bi_crm_company_people role primary_applicant on the application's company
//   directors / partners matched by email, then phone (last 10 digits, the name must agree or the record be a
//                        placeholder), else created; system tag partner; company role partner ("Director")
//   guarantor            guarantor_name / _email / _phone and guarantor lists: system tag guarantor; role guarantor
// Runs when the CRM reads a company's people for an application not yet synced, and once over every application
// (backfillBiCrmPeopleOnce, recorded in bi_crm_backfill_runs). Safe to repeat: it only adds what is missing.
import type { Q } from "./tags";
import { applicationPeople, personFromObject } from "./people";
import { toE164 } from "./textClean";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const txt = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t || null;
};
const digits10 = (v: unknown): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const isPlaceholder = (name: unknown) => {
  const t = String(name ?? "").trim().toLowerCase();
  return !t || t === "unknown" || t.includes("application started");
};
const lastWord = (name: unknown) => String(name ?? "").trim().toLowerCase().split(/\s+/).pop() ?? "";

type PersonIn = { name: string | null; email: string | null; phone: string | null; title?: string | null };

/** A live contact with this email, else this phone whose name agrees (or is a placeholder). */
export async function findBiContact(db: Q, email: string | null, phone: string | null, name: string | null): Promise<{ id: string } | null> {
  if (email) {
    const r = await db.query(
      `SELECT id::text AS id FROM bi_contacts WHERE lower(btrim(email)) = $1 AND converted_to_company_id IS NULL ORDER BY created_at ASC LIMIT 1`,
      [email.toLowerCase().trim()],
    );
    if (r.rows[0]) return { id: String(r.rows[0].id) };
  }
  const p10 = digits10(phone);
  if (p10) {
    const r = await db.query(
      `SELECT id::text AS id, full_name FROM bi_contacts
        WHERE right(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g'), 10) = $1 AND converted_to_company_id IS NULL
        ORDER BY created_at ASC LIMIT 10`,
      [p10],
    );
    const hit = (r.rows as any[]).find((x) => !name || isPlaceholder(x.full_name) || lastWord(x.full_name) === lastWord(name));
    if (hit) return { id: String(hit.id) };
  }
  return null;
}

export async function upsertBiPerson(db: Q, p: PersonIn, tag: string, companyId: string | null): Promise<{ id: string; created: boolean } | null> {
  const name = txt(p.name);
  const email = txt(p.email)?.toLowerCase() ?? null;
  const phone = toE164(p.phone) ?? txt(p.phone);
  if (!name && !email && !phone) return null;
  const found = await findBiContact(db, email, phone, name);
  if (found) {
    await db.query(
      `UPDATE bi_contacts
          SET tags = bi_norm_tags(coalesce(tags, '{}'::text[]) || ARRAY[$2]::text[]),
              company_id = coalesce(company_id, $3::uuid),
              full_name = CASE WHEN $4::text IS NOT NULL AND (btrim(coalesce(full_name, '')) = '' OR full_name ILIKE '%application started%' OR lower(btrim(full_name)) = 'unknown') THEN $4 ELSE full_name END,
              email = coalesce(nullif(btrim(email), ''), $5),
              phone_e164 = coalesce(nullif(btrim(phone_e164), ''), $6),
              updated_at = now()
        WHERE id = $1::uuid`,
      [found.id, tag, companyId, name, email, phone],
    );
    return { id: found.id, created: false };
  }
  const parts = String(name ?? email ?? phone ?? "").split(/\s+/).filter(Boolean);
  const r = await db.query(
    `INSERT INTO bi_contacts (full_name, first_name, last_name, email, phone_e164, company_id, title, tags, source_first)
     VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, ARRAY[$8]::text[], 'application')
     RETURNING id::text AS id`,
    [name ?? email ?? phone, parts[0] ?? null, parts.slice(1).join(" ") || null, email, phone, companyId, txt(p.title), tag],
  );
  return { id: String(r.rows[0].id), created: true };
}

async function linkCompany(db: Q, companyId: string | null, contactId: string, role: string, detail: string | null): Promise<void> {
  if (!companyId) return;
  await db.query(
    `INSERT INTO bi_crm_company_people (company_id, contact_id, role, detail, source)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'application')
     ON CONFLICT (company_id, contact_id) DO UPDATE
        SET role = CASE WHEN bi_crm_company_people.role IN ('other', 'employee') THEN EXCLUDED.role ELSE bi_crm_company_people.role END,
            detail = coalesce(bi_crm_company_people.detail, EXCLUDED.detail)`,
    [companyId, contactId, role, detail],
  );
}

export type BiSyncResult = { applicationId: string; created: number; linked: number };

/** The people of one BI application. */
export async function syncBiApplicationPeople(db: Q, applicationId: string): Promise<BiSyncResult> {
  const out: BiSyncResult = { applicationId, created: 0, linked: 0 };
  const r = await db.query(
    `SELECT a.id::text AS id, a.primary_contact_id::text AS contact_id, coalesce(a.company_id, c.company_id)::text AS company_id,
            a.directors, a.guarantor_name, a.guarantor_email, a.guarantor_phone, a.data, a.form_data
       FROM bi_applications a LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
      WHERE a.id::text = $1 LIMIT 1`,
    [applicationId],
  );
  const app = r.rows[0] as any;
  if (!app) return out;
  if (app.contact_id) { await linkCompany(db, app.company_id, app.contact_id, "primary_applicant", null); out.linked++; }
  const people: Array<{ role: "partner" | "guarantor"; detail: string | null } & PersonIn> = [];
  for (const d of Array.isArray(app.directors) ? app.directors : []) {
    const p = personFromObject(d);
    if (p.name || p.email) people.push({ role: "partner", detail: p.title ?? "Director", ...p });
  }
  if (txt(app.guarantor_name) || txt(app.guarantor_email)) {
    people.push({ role: "guarantor", detail: null, name: txt(app.guarantor_name), email: txt(app.guarantor_email)?.toLowerCase() ?? null, phone: txt(app.guarantor_phone) });
  }
  for (const src of [app.data, app.form_data]) {
    if (!isObj(src)) continue;
    for (const p of applicationPeople(src)) people.push({ role: p.role, detail: p.title, name: p.name, email: p.email, phone: p.phone });
  }
  const seen = new Set<string>();
  for (const p of people) {
    const k = `${p.email ?? ""}|${digits10(p.phone) ?? ""}|${String(p.name ?? "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const person = await upsertBiPerson(db, p, p.role, app.company_id);
    if (!person || person.id === app.contact_id) continue;
    if (person.created) out.created++;
    await linkCompany(db, app.company_id, person.id, p.role, p.detail);
    out.linked++;
  }
  return out;
}

export async function backfillBiCrmPeople(db: Q, limit = 50000): Promise<{ applications: number; created: number; linked: number; failed: number }> {
  const ids = (await db.query(`SELECT id::text AS id FROM bi_applications ORDER BY created_at DESC LIMIT $1`, [limit])).rows.map((x: any) => String(x.id));
  const total = { applications: ids.length, created: 0, linked: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await syncBiApplicationPeople(db, id);
      total.created += r.created;
      total.linked += r.linked;
    } catch (err) {
      total.failed++;
      console.warn("[bi_crm_people_backfill] application failed", { applicationId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return total;
}

export const BI_PEOPLE_BACKFILL_KEY = "v856_people_v1";

export async function backfillBiCrmPeopleOnce(db: Q): Promise<{ ran: boolean; result?: unknown }> {
  const claim = await db.query(
    `INSERT INTO bi_crm_backfill_runs (key) VALUES ($1)
     ON CONFLICT (key) DO UPDATE SET started_at = now()
      WHERE bi_crm_backfill_runs.finished_at IS NULL AND bi_crm_backfill_runs.started_at < now() - interval '1 hour'
     RETURNING key`,
    [BI_PEOPLE_BACKFILL_KEY],
  );
  if (!claim.rows.length) return { ran: false };
  const result = await backfillBiCrmPeople(db);
  await db.query(`UPDATE bi_crm_backfill_runs SET finished_at = now(), result = $2::jsonb WHERE key = $1`, [BI_PEOPLE_BACKFILL_KEY, JSON.stringify(result)]);
  console.log(JSON.stringify({ event: "bi_crm_people_backfill", ...result }));
  return { ran: true, result };
}
