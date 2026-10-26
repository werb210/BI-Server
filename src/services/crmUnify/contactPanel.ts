// BI_SERVER_v856_CRM_UNIFY - the contact page's left panel, the same shape BF-Server serves: the contact's BI applications
// (business, amount, product, stage, submitted date, partners/directors and guarantor, link to the pipeline record).
import type { Q } from "./tags";
import { applicationPeople, personFromObject } from "./people";

const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
// A BI application row exists once the applicant submitted (bi_pipeline_stage has no draft stage).

export async function biContactApplications(db: Q, contactId: string) {
  const r = await db.query(
    `SELECT a.id::text AS id, a.stage, a.status, a.signed_at, a.created_at, a.updated_at, a.directors, a.guarantor_name,
            a.guarantor_email, a.guarantor_phone, a.data, a.form_data, a.facility_type, a.secured_type,
            coalesce(a.coverage_amount, a.loan_amount, a.pgi_limit) AS amount,
            coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.company_name), ''), nullif(btrim(co.legal_name), ''), nullif(btrim(co.operating_name), '')) AS business
       FROM bi_applications a
       LEFT JOIN bi_companies co ON co.id = a.company_id
      WHERE a.primary_contact_id = $1::uuid
      ORDER BY a.updated_at DESC NULLS LAST
      LIMIT 50`,
    [contactId],
  );
  const rows = r.rows as any[];
  const submittedOf = (x: any) => Boolean(x?.id);
  const submitted = rows.filter(submittedOf);
  const shown = submitted.length ? submitted : rows.slice(0, 1);
  const applications = shown.map((x) => {
    const partners: Array<{ contactId: string | null; name: string; role: string; email: string | null; phone: string | null }> = [];
    for (const d of Array.isArray(x.directors) ? x.directors : []) {
      const p = personFromObject(d);
      if (p.name || p.email) partners.push({ contactId: null, name: p.name ?? p.email ?? "(no name)", role: "partner", email: p.email, phone: p.phone });
    }
    if (x.guarantor_name || x.guarantor_email) partners.push({ contactId: null, name: x.guarantor_name ?? x.guarantor_email, role: "guarantor", email: x.guarantor_email ?? null, phone: x.guarantor_phone ?? null });
    for (const src of [x.data, x.form_data]) {
      if (!isObj(src)) continue;
      for (const p of applicationPeople(src)) {
        if (!partners.some((k) => (p.email && k.email === p.email) || (p.name && k.name.toLowerCase() === p.name.toLowerCase()))) {
          partners.push({ contactId: null, name: p.name ?? p.email ?? "(no name)", role: p.role, email: p.email, phone: p.phone });
        }
      }
    }
    return {
      id: String(x.id),
      business: x.business ?? null,
      amount: num(x.amount),
      product: x.facility_type ?? x.secured_type ?? "PGI",
      stage: x.stage ?? x.status ?? null,
      submitted: submittedOf(x),
      submittedAt: iso(x.signed_at ?? x.created_at),
      createdAt: iso(x.created_at),
      role: "applicant",
      partners,
      link: `/silo/bi/pipeline/${encodeURIComponent(String(x.id))}`,
    };
  });
  // Link typed-in people to their contact records when one exists.
  const emails = applications.flatMap((a) => a.partners.map((p) => p.email)).filter(Boolean) as string[];
  if (emails.length) {
    const found = (await db.query(`SELECT id::text AS id, lower(btrim(email)) AS email FROM bi_contacts WHERE lower(btrim(email)) = ANY($1::text[])`, [emails])).rows as any[];
    for (const a of applications) for (const p of a.partners) p.contactId = found.find((f) => f.email === p.email)?.id ?? null;
  }
  return { applications, drafts: rows.length - shown.length };
}
