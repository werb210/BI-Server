// BI_SERVER_v856_CRM_UNIFY - the company left-side panel (same contract as BF-Server v856): every company detail from
// bi_companies, falling back to the latest application's business answers when the record is empty. Edits always
// write bi_companies.
import type { Q } from "./tags";

export type DetailField = {
  key: string;
  label: string;
  value: string | null;
  source: "company" | "application" | null;
  editable: boolean;
  type: "text" | "date" | "number" | "url" | "tel" | "owner" | "readonly";
  raw?: string | null;
};

type Spec = { key: string; label: string; column: string; app: string[]; type: DetailField["type"] };

export const COMPANY_FIELDS: Spec[] = [
  { key: "name", label: "Company name", column: "legal_name", app: ["business_name"], type: "text" },
  { key: "dba_name", label: "Operating / DBA name", column: "operating_name", app: ["data.business.dbaName", "data.business.operatingName"], type: "text" },
  { key: "address", label: "Address", column: "address_line1", app: ["business_address", "data.business.address"], type: "text" },
  { key: "city", label: "City", column: "city", app: ["data.business.city"], type: "text" },
  { key: "province", label: "Province / State", column: "province", app: ["data.business.province", "data.business.state"], type: "text" },
  { key: "postal_code", label: "Postal / ZIP", column: "postal_code", app: ["data.business.postalCode", "data.business.postal_code"], type: "text" },
  { key: "country", label: "Country", column: "country", app: ["country", "data.business.country"], type: "text" },
  { key: "phone", label: "Phone", column: "phone", app: ["data.business.phone"], type: "tel" },
  { key: "email", label: "Email", column: "email", app: [], type: "text" },
  { key: "website", label: "Website", column: "website", app: ["business_website", "data.business.website"], type: "url" },
  { key: "industry", label: "Industry", column: "industry", app: ["data.business.industry", "naics_code"], type: "text" },
  { key: "entity_type", label: "Entity type", column: "entity_type", app: ["entity_type", "data.business.entityType"], type: "text" },
  { key: "business_number", label: "Business number", column: "business_number", app: ["business_number"], type: "text" },
  { key: "start_date", label: "Start date", column: "start_date", app: ["formation_date", "data.business.startDate"], type: "date" },
  { key: "time_in_business", label: "Time in business", column: "time_in_business", app: ["data.business.timeInBusiness"], type: "text" },
  { key: "employees", label: "Employees", column: "employees", app: ["data.business.employees", "data.business.numberOfEmployees"], type: "number" },
  { key: "annual_revenue", label: "Annual revenue", column: "annual_revenue", app: ["annual_revenue", "data.business.annualRevenue"], type: "number" },
  { key: "domain", label: "Domain", column: "domain", app: [], type: "text" },
];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const clean = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = String(v).replace(/\s+/g, " ").trim();
  return t ? t : null;
};

function pick(app: Record<string, any>, path: string): unknown {
  if (!path.startsWith("data.")) return app[path];
  const [, ...rest] = path.split(".");
  for (const root of [app.data, app.form_data]) {
    let cur: any = root;
    for (const k of rest) cur = isObj(cur) ? cur[k] : undefined;
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}

export function domainOf(website: unknown, email?: unknown): string | null {
  const w = clean(website);
  if (w) {
    try {
      const host = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`).hostname.toLowerCase().replace(/^www\./, "");
      if (host.includes(".")) return host;
    } catch { /* fall through */ }
  }
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email ?? "").trim());
  return m?.[1]?.toLowerCase() ?? null;
}

export function buildCompanyDetails(company: Record<string, any>, app: Record<string, any> | null): DetailField[] {
  const fields: DetailField[] = COMPANY_FIELDS.map((f) => {
    let value = clean(company[f.column]);
    let source: DetailField["source"] = value ? "company" : null;
    if (!value && app) {
      for (const p of f.app) { const v = clean(pick(app, p)); if (v) { value = v; source = "application"; break; } }
    }
    return { key: f.key, label: f.label, value, source, editable: true, type: f.type };
  });
  const domain = fields.find((f) => f.key === "domain")!;
  if (!domain.value) {
    const website = fields.find((f) => f.key === "website")!;
    const d = domainOf(website.value, company.email);
    if (d) { domain.value = d; domain.source = website.value ? website.source : "company"; }
  }
  // The owner is a BF staff user: the portal shows the name from its staff list (raw is the id).
  fields.push({ key: "owner_id", label: "Owner", value: null, raw: company.owner_id ? String(company.owner_id) : null, source: company.owner_id ? "company" : null, editable: true, type: "owner" });
  fields.push({ key: "created_at", label: "Created", value: clean(company.created_at instanceof Date ? company.created_at.toISOString() : company.created_at), source: "company", editable: false, type: "readonly" });
  return fields;
}

export async function companyDetails(db: Q, companyId: string): Promise<{ company: Record<string, any>; fields: DetailField[] } | null> {
  const co = (await db.query(`SELECT * FROM bi_companies WHERE id = $1::uuid LIMIT 1`, [companyId])).rows[0];
  if (!co) return null;
  const app = (await db.query(
    `SELECT business_name, business_address, business_website, entity_type, business_number, formation_date, annual_revenue,
            country, naics_code, data, form_data
       FROM bi_applications WHERE company_id = $1::uuid ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [companyId],
  )).rows[0] ?? null;
  return { company: co, fields: buildCompanyDetails(co, app) };
}

export function detailUpdates(body: Record<string, unknown>): { ok: true; sets: Array<[string, unknown]> } | { ok: false; field: string; error: string } {
  const sets: Array<[string, unknown]> = [];
  for (const [key, raw] of Object.entries(body ?? {})) {
    if (key === "owner_id") {
      const v = raw == null || raw === "" ? null : String(raw);
      if (v && !/^[0-9a-f-]{36}$/i.test(v)) return { ok: false, field: key, error: "owner must be a staff user" };
      sets.push(["owner_id", v]);
      continue;
    }
    const spec = COMPANY_FIELDS.find((f) => f.key === key);
    if (!spec) continue;
    let v: unknown = raw == null ? null : String(raw).replace(/\s+/g, " ").trim().slice(0, 300);
    if (v === "") v = null;
    if (spec.key === "name" && !v) return { ok: false, field: key, error: "Company name is required" };
    if (spec.type === "date" && v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return { ok: false, field: key, error: "Use the format yyyy-mm-dd" };
    if (spec.type === "number" && v != null) {
      const n = Number(String(v).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return { ok: false, field: key, error: "Enter a number" };
      v = spec.key === "employees" ? Math.round(n) : n;
    }
    if (spec.key === "domain" && v != null) v = domainOf(v) ?? String(v).toLowerCase();
    sets.push([spec.column, v]);
  }
  return { ok: true, sets };
}
