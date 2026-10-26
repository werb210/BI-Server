// BI_SERVER_v856_CRM_UNIFY - possible duplicates in the BI CRM, the same rules as BF-Server v856:
//   contacts:  same email (case and spaces ignored), same phone (last 10 digits), exactly the same full name (any
//              company), or a similar name AND the same company. Placeholder names never match on name, but do match
//              on phone / email - and the real record is suggested as the survivor.
//   companies: the same name once legal suffixes and punctuation are ignored, one name the start of the other
//              ("Big Broker" / "Big Brokerage"), the same website domain, the same phone (last 10 digits) or email.
// Pairs staff mark "Not a duplicate" (bi_crm_duplicate_dismissals) are left out.
import type { Q } from "./tags";

const SUFFIX_RE = /\b(llc|l l c|inc|incorporated|ltd|limited|corp|corporation|co|company|llp|lp|plc|ulc|pllc|pc|ltee|the)\b/g;

export function normCompanyName(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX_RE, " ").replace(/\s+/g, " ").trim();
}

export function companyNamesSimilar(a: unknown, b: unknown): boolean {
  const x = normCompanyName(a);
  const y = normCompanyName(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, "") === y.replace(/ /g, "")) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 5) return false;
  if (long.startsWith(short + " ")) return true;
  // A shortened last word: "big broker" / "big brokerage" (at most 6 letters more).
  return long.startsWith(short) && long.length - short.length <= 6 && !long.slice(short.length).includes(" ");
}

export function isPlaceholderName(name: unknown): boolean {
  const t = String(name ?? "").trim();
  return !t || PLACEHOLDER_RE.test(t);
}

/** Exactly the same full name (spacing and case ignored); placeholders never. */
export function sameFullName(a: unknown, b: unknown): boolean {
  if (isPlaceholderName(a) || isPlaceholderName(b)) return false;
  const n = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}

/** The record to keep: a real name over a placeholder, then the one with applications, then the oldest. */
export function suggestSurvivor(records: Array<{ id: string; name?: unknown; application_count?: unknown; created_at?: unknown }>): string {
  const ranked = [...records].sort((a, b) =>
    Number(isPlaceholderName(a.name)) - Number(isPlaceholderName(b.name))
    || Number(b.application_count ?? 0) - Number(a.application_count ?? 0)
    || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return String(ranked[0]?.id ?? "");
}

const PLACEHOLDER = /application started|^\s*unknown\s*$|^\s*new applicant/i;
const PLACEHOLDER_RE = PLACEHOLDER;
const normName = (n: unknown) => String(n ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();

/** The TypeScript twin of BF-Server's bf_same_person_name(): same surname and a compatible first name. */
export function samePersonName(a: unknown, b: unknown): boolean {
  if (PLACEHOLDER.test(String(a ?? "")) || PLACEHOLDER.test(String(b ?? ""))) return false;
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" ");
  const ys = y.split(" ");
  const sx = xs[xs.length - 1]!;
  const sy = ys[ys.length - 1]!;
  if (xs.length < 2 || ys.length < 2 || sx !== sy || sx.length < 2) return false;
  const fx = xs[0]!;
  const fy = ys[0]!;
  return fx === fy || (fx.length >= 3 && fy.startsWith(fx)) || (fy.length >= 3 && fx.startsWith(fy)) || fx[0] === fy[0];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

async function dismissedPairs(db: Q, entity: "contact" | "company"): Promise<Set<string>> {
  const r = await db.query(`SELECT a_id::text AS a, b_id::text AS b FROM bi_crm_duplicate_dismissals WHERE entity = $1`, [entity]);
  return new Set(r.rows.map((x: any) => pairKey(String(x.a), String(x.b))));
}

export type DuplicateCandidate = {
  id: string; name: string | null; email: string | null; phone: string | null; company_name: string | null;
  created_at: string | null; reasons: string[]; placeholder?: boolean;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function contactDuplicates(db: Q, contactId: string): Promise<DuplicateCandidate[]> {
  const me = (await db.query(`SELECT id::text AS id, full_name, email, phone_e164, company_id::text AS company_id FROM bi_contacts WHERE id = $1::uuid`, [contactId])).rows[0];
  if (!me) return [];
  const email = String(me.email ?? "").replace(/\s+/g, "").toLowerCase();
  const digits = String(me.phone_e164 ?? "").replace(/\D/g, "");
  const p10 = digits.length >= 10 ? digits.slice(-10) : null;
  const r = await db.query(
    `SELECT c.id::text AS id, c.full_name, c.email, c.phone_e164, c.company_id::text AS company_id, c.created_at, co.legal_name AS company_name
       FROM bi_contacts c
       LEFT JOIN bi_companies co ON co.id = c.company_id
      WHERE c.id <> $1::uuid AND c.converted_to_company_id IS NULL
        AND (($2::text <> '' AND lower(regexp_replace(coalesce(c.email, ''), '\\s', '', 'g')) = $2::text)
          OR ($3::text IS NOT NULL AND right(regexp_replace(coalesce(c.phone_e164, ''), '\\D', '', 'g'), 10) = $3::text)
          OR ($4::uuid IS NOT NULL AND c.company_id = $4::uuid)
          OR ($5::text <> '' AND lower(regexp_replace(btrim(coalesce(c.full_name, '')), '\\s+', ' ', 'g')) = $5::text))
      LIMIT 500`,
    [contactId, email, p10, me.company_id ?? null, isPlaceholderName(me.full_name) ? "" : String(me.full_name ?? "").toLowerCase().replace(/\s+/g, " ").trim()],
  );
  const dismissed = await dismissedPairs(db, "contact");
  const out: DuplicateCandidate[] = [];
  for (const row of r.rows) {
    const reasons: string[] = [];
    if (email && String(row.email ?? "").replace(/\s+/g, "").toLowerCase() === email) reasons.push("Same email");
    const d = String(row.phone_e164 ?? "").replace(/\D/g, "");
    if (p10 && d.length >= 10 && d.slice(-10) === p10) reasons.push("Same phone");
    if (sameFullName(row.full_name, me.full_name)) reasons.push("Same name");
    else if (me.company_id && row.company_id === me.company_id && samePersonName(row.full_name, me.full_name)) reasons.push("Similar name, same company");
    if (!reasons.length || dismissed.has(pairKey(contactId, String(row.id)))) continue;
    out.push({ id: String(row.id), name: row.full_name ?? null, email: row.email ?? null, phone: row.phone_e164 ?? null, company_name: row.company_name ?? null, created_at: iso(row.created_at), reasons, placeholder: isPlaceholderName(row.full_name) });
  }
  return out.slice(0, 25);
}

const host = (v: unknown): string | null => {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return null;
  try { return new URL(/^https?:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "") || null; } catch { return null; }
};
const phone10 = (v: unknown): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

export function companyReasons(a: any, b: any): string[] {
  const out: string[] = [];
  const namesA = [a.legal_name, a.operating_name].filter(Boolean);
  const namesB = [b.legal_name, b.operating_name].filter(Boolean);
  if (namesA.some((x) => namesB.some((y) => normCompanyName(x) && normCompanyName(x) === normCompanyName(y)))) out.push("Same name");
  else if (namesA.some((x) => namesB.some((y) => companyNamesSimilar(x, y)))) out.push("Similar name");
  const ha = host(a.website) ?? host(a.domain);
  if (ha && ha === (host(b.website) ?? host(b.domain))) out.push("Same website");
  const pa = phone10(a.phone);
  if (pa && pa === phone10(b.phone)) out.push("Same phone");
  const ea = String(a.email ?? "").trim().toLowerCase();
  if (ea && ea === String(b.email ?? "").trim().toLowerCase()) out.push("Same email");
  return out;
}

export async function companyDuplicates(db: Q, companyId: string): Promise<DuplicateCandidate[]> {
  const all = (await db.query(`SELECT id::text AS id, legal_name, operating_name, website, domain, phone, email, created_at FROM bi_companies LIMIT 20000`)).rows;
  const me = all.find((x: any) => x.id === companyId);
  if (!me) return [];
  const dismissed = await dismissedPairs(db, "company");
  return all
    .filter((row: any) => row.id !== companyId)
    .map((row: any) => ({ row, reasons: companyReasons(me, row) }))
    .filter((x: any) => x.reasons.length > 0 && !dismissed.has(pairKey(companyId, String(x.row.id))))
    .slice(0, 25)
    .map(({ row, reasons }: any) => ({ id: String(row.id), name: row.legal_name ?? null, email: row.email ?? null, phone: row.phone ?? null, company_name: row.operating_name ?? null, created_at: iso(row.created_at), reasons }));
}

export type DuplicateGroup = { ids: string[]; records: Array<Record<string, unknown>>; reasons: string[]; survivorId: string; placeholders: number };

function groupPairs(pairs: Array<{ a: string; b: string; reasons: string[] }>, dismissed: Set<string>, records: Record<string, any>, limit: number): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const kept: Array<{ a: string; reasons: string[] }> = [];
  for (const p of pairs) {
    if (dismissed.has(pairKey(p.a, p.b))) continue;
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent.set(ra, rb);
    kept.push({ a: p.a, reasons: p.reasons });
  }
  const groups = new Map<string, string[]>();
  for (const id of Array.from(parent.keys())) { const root = find(id); groups.set(root, [...(groups.get(root) ?? []), id]); }
  const reasonsBy = new Map<string, Set<string>>();
  for (const k of kept) { const root = find(k.a); const set = reasonsBy.get(root) ?? new Set<string>(); k.reasons.forEach((r) => set.add(r)); reasonsBy.set(root, set); }
  const out: DuplicateGroup[] = [];
  for (const [root, ids] of groups) {
    if (ids.length < 2) continue;
    const recs = ids.sort().map((id) => records[id]).filter(Boolean);
    out.push({
      ids, records: recs, reasons: Array.from(reasonsBy.get(root) ?? []),
      survivorId: suggestSurvivor(recs), placeholders: recs.filter((r: any) => r.placeholder === true).length,
    });
  }
  out.sort((a, b) => b.ids.length - a.ids.length || String(a.records[0]?.name ?? "").localeCompare(String(b.records[0]?.name ?? "")));
  return out.slice(0, limit);
}

export async function duplicateGroups(db: Q, entity: "contact" | "company", limit = 200): Promise<DuplicateGroup[]> {
  const dismissed = await dismissedPairs(db, entity);
  const pairs: Array<{ a: string; b: string; reasons: string[] }> = [];
  const records: Record<string, any> = {};
  if (entity === "contact") {
    const all = (await db.query(
      `SELECT c.id::text AS id, c.full_name, c.email, c.phone_e164, c.company_id::text AS company_id, c.created_at, co.legal_name AS company_name,
              (SELECT count(*)::int FROM bi_applications a WHERE a.primary_contact_id = c.id) AS application_count
         FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id
        WHERE c.converted_to_company_id IS NULL
        LIMIT 50000`,
    )).rows;
    const buckets = new Map<string, any[]>();
    const put = (k: string | null, row: any) => { if (!k) return; const list = buckets.get(k) ?? []; list.push(row); buckets.set(k, list); };
    for (const row of all) {
      records[row.id] = {
        id: row.id, name: row.full_name, email: row.email, phone: row.phone_e164, company_name: row.company_name, created_at: iso(row.created_at),
        placeholder: isPlaceholderName(row.full_name), application_count: Number(row.application_count ?? 0),
      };
      const em = String(row.email ?? "").replace(/\s+/g, "").toLowerCase();
      put(em ? "e:" + em : null, row);
      put(phone10(row.phone_e164) ? "p:" + phone10(row.phone_e164) : null, row);
      put(row.company_id ? "c:" + row.company_id : null, row);
      put(isPlaceholderName(row.full_name) ? null : "n:" + String(row.full_name ?? "").toLowerCase().replace(/\s+/g, " ").trim(), row);
    }
    const seen = new Set<string>();
    for (const [, list] of buckets) {
      if (list.length < 2 || list.length > 400) continue;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i]; const b = list[j];
        const pk = pairKey(a.id, b.id);
        if (seen.has(pk)) continue;
        seen.add(pk);
        const reasons: string[] = [];
        const ea = String(a.email ?? "").replace(/\s+/g, "").toLowerCase();
        if (ea && ea === String(b.email ?? "").replace(/\s+/g, "").toLowerCase()) reasons.push("Same email");
        const pa = phone10(a.phone_e164);
        if (pa && pa === phone10(b.phone_e164)) reasons.push("Same phone");
        if (sameFullName(a.full_name, b.full_name)) reasons.push("Same name");
        else if (a.company_id && a.company_id === b.company_id && samePersonName(a.full_name, b.full_name)) reasons.push("Similar name, same company");
        if (reasons.length) pairs.push({ a: a.id, b: b.id, reasons });
      }
    }
  } else {
    const all = (await db.query(`SELECT id::text AS id, legal_name, operating_name, website, domain, phone, email, created_at FROM bi_companies LIMIT 20000`)).rows;
    const buckets = new Map<string, any[]>();
    const put = (k: string, row: any) => { const list = buckets.get(k) ?? []; list.push(row); buckets.set(k, list); };
    for (const row of all) {
      records[row.id] = { id: row.id, name: row.legal_name, email: row.email, phone: row.phone, company_name: row.operating_name, website: row.website, created_at: iso(row.created_at) };
      const n = normCompanyName(row.legal_name).replace(/ /g, "").slice(0, 3);
      if (n) put("n:" + n, row);
      const h = host(row.website) ?? host(row.domain);
      if (h) put("h:" + h, row);
      const p = phone10(row.phone);
      if (p) put("p:" + p, row);
    }
    const seen = new Set<string>();
    for (const [, list] of buckets) {
      if (list.length < 2 || list.length > 400) continue;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const pk = pairKey(list[i].id, list[j].id);
        if (seen.has(pk)) continue;
        seen.add(pk);
        const reasons = companyReasons(list[i], list[j]);
        if (reasons.length) pairs.push({ a: list[i].id, b: list[j].id, reasons });
      }
    }
  }
  return groupPairs(pairs, dismissed, records, limit);
}

export async function dismissDuplicate(db: Q, entity: "contact" | "company", a: string, b: string, userId: string | null): Promise<void> {
  const [x, y] = a < b ? [a, b] : [b, a];
  await db.query(
    `INSERT INTO bi_crm_duplicate_dismissals (entity, a_id, b_id, created_by) VALUES ($1, $2::uuid, $3::uuid, $4)
     ON CONFLICT (entity, a_id, b_id) DO NOTHING`,
    [entity, x, y, userId],
  );
}

export const CONTACT_MERGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "full_name", label: "Name" }, { key: "first_name", label: "First name" }, { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" }, { key: "phone_e164", label: "Phone" }, { key: "title", label: "Title" },
  { key: "company_id", label: "Company" }, { key: "outreach_owner_id", label: "Owner" }, { key: "outreach_status", label: "Lead status" },
  { key: "city", label: "City" }, { key: "state", label: "Province / State" }, { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn" },
];
export const COMPANY_MERGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "legal_name", label: "Company name" }, { key: "operating_name", label: "Operating / DBA name" },
  { key: "business_number", label: "Business number" }, { key: "website", label: "Website" }, { key: "domain", label: "Domain" },
  { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "industry", label: "Industry" },
  { key: "entity_type", label: "Entity type" }, { key: "address_line1", label: "Address" }, { key: "city", label: "City" },
  { key: "province", label: "Province / State" }, { key: "postal_code", label: "Postal / ZIP" }, { key: "country", label: "Country" },
  { key: "start_date", label: "Start date" }, { key: "employees", label: "Employees" }, { key: "annual_revenue", label: "Annual revenue" },
  { key: "owner_id", label: "Owner" },
];

export async function mergePreview(db: Q, entity: "contact" | "company", ids: string[]) {
  const fields = entity === "contact" ? CONTACT_MERGE_FIELDS : COMPANY_MERGE_FIELDS;
  const r = await db.query(
    entity === "contact"
      ? `SELECT c.*, co.legal_name AS company_label,
                (SELECT count(*)::int FROM bi_applications a WHERE a.primary_contact_id = c.id) AS application_count
           FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id
          WHERE c.id = ANY($1::uuid[])`
      : `SELECT co.*,
                (SELECT count(*)::int FROM bi_applications a WHERE a.company_id = co.id) AS application_count,
                (SELECT count(*)::int FROM bi_contacts c WHERE c.company_id = co.id) AS contact_count
           FROM bi_companies co WHERE co.id = ANY($1::uuid[])`,
    [ids],
  );
  const records = ids.map((id) => r.rows.find((x: any) => String(x.id) === id)).filter(Boolean) as any[];
  const str = (v: unknown) => (v == null || v === "" ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  return {
    records: records.map((row) => ({
      id: String(row.id),
      title: row.full_name ?? row.legal_name ?? row.email ?? String(row.id),
      tags: Array.isArray(row.tags) ? row.tags : [],
      created_at: iso(row.created_at),
      application_count: Number(row.application_count ?? 0),
      contact_count: row.contact_count == null ? undefined : Number(row.contact_count),
    })),
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      values: records.map((row) => ({ id: String(row.id), value: str(row[f.key]), display: f.key === "company_id" ? (row.company_label ?? null) : str(row[f.key]) })),
    })),
  };
}

export function pickFieldChoices(fields: Array<{ key: string }>, rows: any[], choices: unknown): Array<[string, unknown]> {
  if (!choices || typeof choices !== "object") return [];
  const out: Array<[string, unknown]> = [];
  const norm = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  for (const [key, chosen] of Object.entries(choices as Record<string, unknown>)) {
    if (!fields.some((f) => f.key === key)) continue;
    const match = rows.find((row) => norm(row[key]) === norm(chosen));
    if (match) out.push([key, match[key] ?? null]);
  }
  return out;
}
