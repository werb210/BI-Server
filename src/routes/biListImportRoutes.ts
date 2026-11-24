// BI_SERVER_LIST_IMPORT_v1 - import a researched prospect list (companies and the people at them) in one call.
//   POST /api/v1/bi/crm/list-import   { companies?: [...], contacts?: [...] }
// The file-upload imports beside this one read HubSpot exports and keep only the basics. A prospect list carries more:
// tags, a mobile, a mailing address, "do not call" marks and research fields (source, verification notes). This keeps
// them, links each person to their company, and can be run again with a richer copy of the same list: a company is
// matched by name, a person by email, or by name and company while they have no email on file.
// Records only: nothing is emailed, texted, enrolled or given a consent basis here.
import express, { type Request, type Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { logger } from "../platform/logger";
import { isCompanySuppressed } from "../services/biCrmSuppression";

const router = express.Router();

export const LIST_IMPORT_MAX = 5000;
const text = (v: unknown, max = 300): string | null => {
  const t = String(v ?? "").trim().slice(0, max);
  return t ? t : null;
};
/** Lower-case, de-duplicated tags (the CRM compares tags in lower case). */
export function listTags(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(/[;|]/);
  return [...new Set(parts.map((x) => x.trim().toLowerCase().slice(0, 80)).filter(Boolean))].slice(0, 30);
}
/** "(905) 660-1898 ext. 225" -> { number: "+19056601898", extension: "225" }; a number that is not North American -> null. */
export function listPhone(v: unknown): { number: string; extension: string | null } | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)(?:\s*(?:ext\.?|x|extension)\s*(\d{1,8}))?$/i);
  const digits = String(m?.[1] ?? raw).replace(/[^\d+]/g, "");
  const extension = m?.[2] ?? null;
  if (/^\+\d{8,15}$/.test(digits)) return { number: digits, extension };
  if (/^\d{10}$/.test(digits)) return { number: `+1${digits}`, extension };
  if (/^1\d{10}$/.test(digits)) return { number: `+${digits}`, extension };
  return null;
}
export function listCustom(v: unknown): Record<string, string | number | boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(k)) continue;
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "boolean") out[k] = val;
    else if (String(val ?? "").trim()) out[k] = String(val).trim().slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}
const country = (v: unknown): string | null => {
  const c = String(v ?? "").trim().toUpperCase();
  if (!c) return null;
  if (["CDN", "CANADA", "CA"].includes(c)) return "CA";
  if (["US", "USA", "UNITED STATES"].includes(c)) return "US";
  return c.slice(0, 8);
};

router.post("/crm/list-import", requireAuth, async (req: Request, res: Response) => {
  const companies: any[] = Array.isArray(req.body?.companies) ? req.body.companies : [];
  const contacts: any[] = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (!companies.length && !contacts.length) return res.status(400).json({ ok: false, error: "nothing_to_import" });
  if (companies.length > LIST_IMPORT_MAX || contacts.length > LIST_IMPORT_MAX) return res.status(400).json({ ok: false, error: "too_many_rows", max: LIST_IMPORT_MAX });
  const actor = ((req as any).user ?? {}) as { staffUserId?: string; name?: string };
  const ownerId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;
  const out = { ok: true, companies_created: 0, companies_updated: 0, contacts_created: 0, contacts_updated: 0, skipped: 0, errors: [] as Array<{ kind: string; name: string; error: string }> };
  const fail = (kind: string, name: string, error: string) => { out.skipped++; if (out.errors.length < 200) out.errors.push({ kind, name, error }); };

  for (const r of companies) {
    const name = text(r?.name, 300);
    if (!name) { fail("company", "", "missing_name"); continue; }
    try {
      if (await isCompanySuppressed(pool, name)) { fail("company", name, "suppressed"); continue; }
      const phone = listPhone(r.phone)?.number ?? null;
      const staff = Number.isFinite(Number(r.employee_count)) && Number(r.employee_count) > 0 ? Math.round(Number(r.employee_count)) : null;
      const kind = r.kind === "lender" ? "lender" : null;
      const tags = listTags(r.tags);
      const custom = listCustom(r.custom_fields);
      const vals = [name, text(r.website), phone, text(r.industry, 200), text(r.address_city ?? r.city, 120), text(r.address_state ?? r.province, 120), text(r.address_zip, 40),
        text(r.address_street), country(r.address_country ?? r.country), text(r.domain, 200), staff, kind, tags, JSON.stringify(custom ?? {})];
      const found = await pool.query<{ id: string }>(`SELECT id FROM bi_companies WHERE lower(legal_name) = lower($1) LIMIT 1`, [name]);
      if (found.rows[0]) {
        await pool.query(
          `UPDATE bi_companies SET website = COALESCE($2, website), phone = COALESCE($3, phone), industry = COALESCE($4, industry), city = COALESCE($5, city),
              province = COALESCE($6, province), postal_code = COALESCE($7, postal_code), address_line1 = COALESCE($8, address_line1), country = COALESCE($9, country),
              domain = COALESCE($10, domain), employees = COALESCE($11, employees), kind = COALESCE($12, kind),
              tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(bi_companies.tags, '{}'::text[]) || $13::text[]))),
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $14::jsonb, updated_at = NOW()
            WHERE lower(legal_name) = lower($1)`, vals);
        out.companies_updated++;
      } else {
        await pool.query(
          `INSERT INTO bi_companies (legal_name, website, phone, industry, city, province, postal_code, address_line1, country, domain, employees, kind, tags, custom_fields, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'applicant'), $13::text[], $14::jsonb, $15)`, [...vals, ownerId]);
        out.companies_created++;
      }
    } catch (e: any) {
      logger.error({ err: e, company: name }, "list_import_company_failed");
      fail("company", name, "row_failed");
    }
  }

  for (const r of contacts) {
    const fullName = text(r?.name, 200);
    if (!fullName) { fail("contact", "", "missing_name"); continue; }
    try {
      const email = text(r.email, 320);
      if (email) {
        const supp = await pool.query(`SELECT 1 FROM bi_suppressions WHERE lower(email) = lower($1) LIMIT 1`, [email]);
        if (supp.rows.length) { fail("contact", fullName, "suppressed"); continue; }
      }
      const companyName = text(r.company_name, 300);
      let companyId: string | null = null;
      if (companyName) {
        const co = await pool.query<{ id: string }>(`SELECT id FROM bi_companies WHERE lower(legal_name) = lower($1) LIMIT 1`, [companyName]);
        companyId = co.rows[0]?.id ?? null;
      }
      const main = listPhone(r.phone);
      const mobile = listPhone(r.mobile);
      const numbers = [main ? { type: "work", number: main.number, ...(main.extension ? { extension: main.extension } : {}) } : null, mobile ? { type: "mobile", number: mobile.number } : null].filter(Boolean);
      const tags = listTags(r.tags);
      const custom = listCustom(r.custom_fields);
      const parts = fullName.split(/\s+/);
      const noteLines = [text(r.notes, 4000), main?.extension ? `Extension ${main.extension}` : null].filter(Boolean).join("\n") || null;

      let existing = email ? (await pool.query<{ id: string }>(`SELECT id FROM bi_contacts WHERE lower(email) = lower($1) LIMIT 1`, [email])).rows[0] : undefined;
      if (!existing && companyName) {
        existing = (await pool.query<{ id: string }>(
          `SELECT c.id FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id
            WHERE COALESCE(c.email, '') = '' AND lower(trim(c.full_name)) = lower($1)
              AND (lower(COALESCE(co.legal_name, '')) = lower($2) OR lower(COALESCE(c.organization_name, '')) = lower($2)) LIMIT 1`, [fullName, companyName])).rows[0];
      }
      const vals = [fullName, email, main?.number ?? mobile?.number ?? null, companyId, text(r.job_title, 200), noteLines, tags, JSON.stringify(custom ?? {}),
        companyName, text(r.address_city, 120), text(r.address_state, 120), country(r.address_country), JSON.stringify(numbers)];
      let contactId: string;
      if (existing) {
        contactId = existing.id;
        await pool.query(
          `UPDATE bi_contacts SET full_name = $2, email = COALESCE($3, email), phone_e164 = COALESCE($4, phone_e164), company_id = COALESCE($5, company_id),
              title = COALESCE($6, title), notes = COALESCE(notes, $7),
              tags = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(bi_contacts.tags, '{}'::text[]) || $8::text[]))),
              custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $9::jsonb, organization_name = COALESCE($10, organization_name),
              city = COALESCE($11, city), state = COALESCE($12, state), country = COALESCE($13, country),
              phone_numbers = CASE WHEN jsonb_array_length($14::jsonb) > 0 THEN $14::jsonb ELSE phone_numbers END, updated_at = NOW()
            WHERE id = $1`, [contactId, ...vals]);
        out.contacts_updated++;
      } else {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO bi_contacts (full_name, email, phone_e164, company_id, title, notes, tags, custom_fields, organization_name, city, state, country, phone_numbers,
              first_name, last_name, source_first, outreach_status, outreach_owner_id, outreach_updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, 'cold', $17, NOW()) RETURNING id`,
          [...vals, parts[0] ?? null, parts.slice(1).join(" ") || null, text(req.body?.source, 120) ?? "list import", ownerId]);
        contactId = ins.rows[0]!.id;
        out.contacts_created++;
      }
      await pool.query(
        `INSERT INTO bi_contact_activity (id, contact_id, actor_id, event_type, body, meta) VALUES (gen_random_uuid(), $1, $2, 'import', $3, $4::jsonb)`,
        [contactId, ownerId, `${existing ? "Updated" : "Added"} from ${text(req.body?.source, 120) ?? "a list import"}`, JSON.stringify({ list: text(req.body?.source, 120) })]);
    } catch (e: any) {
      logger.error({ err: e, contact: fullName }, "list_import_contact_failed");
      fail("contact", fullName, "row_failed");
    }
  }
  logger.info({ event: "crm_list_import", source: text(req.body?.source, 120), ...out, errors: out.errors.length }, "crm_list_import");
  if (res.headersSent) return; // the timeout guard already answered
  return res.json(out);
});


// BF_SHARED_CONTACTS_STAGE2_v1 (2026-11-24) - BF-Server's shared contact list pulls every broker, lender and bank person
// from here each night (service token), so lists loaded before the shared list existed are in it too. Read only.
// GET /api/v1/bi/crm/directory-export?after=<contact id>&limit=1000
export const DIRECTORY_EXPORT_SQL = `
  SELECT c.id, c.full_name, c.email, c.phone_e164, c.title, c.city, c.state,
         CASE WHEN lower(btrim(coalesce(c.country, ''))) IN ('us', 'usa', 'united states', 'united states of america')
                OR EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'us %') THEN 'US'
              WHEN lower(btrim(coalesce(c.country, ''))) IN ('ca', 'can', 'canada') OR coalesce(c.country, '') = '' THEN 'CA'
              ELSE upper(left(btrim(c.country), 2)) END AS country,
         CASE WHEN EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'broker%') THEN 'broker'
              WHEN EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'bank%') THEN 'bank'
              ELSE 'lender' END AS kind,
         COALESCE(co.operating_name, co.legal_name, c.organization_name) AS company, co.website,
         EXISTS (SELECT 1 FROM bi_suppressions s
                  WHERE (lower(s.email) = lower(c.email) OR lower(s.identifier) = lower(c.email) OR s.contact_id = c.id)
                    AND s.channel IN ('email', 'all')) AS opted_out,
         c.outreach_status, c.updated_at
    FROM bi_contacts c
    LEFT JOIN bi_companies co ON co.id = c.company_id
   WHERE EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t
                  WHERE lower(btrim(t)) LIKE 'broker%' OR lower(btrim(t)) LIKE 'lender%' OR lower(btrim(t)) LIKE 'bank%')
     AND ($1::uuid IS NULL OR c.id > $1::uuid)
   ORDER BY c.id
   LIMIT $2`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get("/crm/directory-export", requireAuth, async (req: Request, res: Response) => {
  const after = UUID_RE.test(String(req.query.after ?? "")) ? String(req.query.after) : null;
  const limit = Math.max(1, Math.min(2000, Math.trunc(Number(req.query.limit) || 1000)));
  try {
    const r = await pool.query(DIRECTORY_EXPORT_SQL, [after, limit]);
    const items = r.rows;
    return res.json({ ok: true, items, next: items.length === limit ? items[items.length - 1].id : null });
  } catch (err) {
    logger.error({ err }, "directory_export_failed");
    return res.status(500).json({ ok: false, error: "export_failed" });
  }
});

export default router;
