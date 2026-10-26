// BI_SERVER_v856_CRM_UNIFY - the AI summary card for the BI CRM (same contract as BF-Server v856): generated on
// request, cached (bi_crm_ai_summaries) and shown with its sources - the company's own website (the website field,
// else the domain of a work email; free email providers skipped), read through the SSRF-guarded fetcher
// (webSource.ts) and summarised as "what the business does" (cached 30 days in bi_crm_web_profiles), plus the CRM
// records counted below.
import type { Q } from "./tags";
import { fetchSiteText, websiteFor } from "./webSource";
import { logger } from "../../platform/logger";

export type SummarySource = { type: string; label: string; detail?: string | null; url?: string | null; status?: "used" | "skipped" | "unavailable" };
export type SummaryPayload = { summary: string; business: string | null; sources: SummarySource[]; generatedAt: string; cached: boolean };
export type Model = (prompt: string) => Promise<string>;

export async function cachedSummary(db: Q, entity: "contact" | "company", id: string): Promise<SummaryPayload | null> {
  const row = (await db.query(`SELECT summary, business, sources, generated_at FROM bi_crm_ai_summaries WHERE entity = $1 AND entity_id = $2::uuid`, [entity, id])).rows[0];
  if (!row) return null;
  return { summary: String(row.summary), business: row.business ?? null, sources: Array.isArray(row.sources) ? row.sources : [], generatedAt: new Date(row.generated_at).toISOString(), cached: true };
}

/** What the business does, from its own website (cached for 30 days). */
export async function websiteBackground(db: Q, model: Model, domain: string, fetchText: typeof fetchSiteText = fetchSiteText): Promise<string | null> {
  const cached = (await db.query(`SELECT summary, fetched_at > now() - interval '30 days' AS fresh FROM bi_crm_web_profiles WHERE domain = $1`, [domain])).rows[0];
  if (cached?.fresh) return cached.summary ?? null;
  const site = await fetchText(domain);
  let summary: string | null = null;
  if (site && site.text.length > 200) {
    summary = (await model(
      `From this company's own website text, describe in at most two sentences what the business does, who it serves and where. Use only what the text says. If it does not describe a business, reply exactly: UNKNOWN\n\nWebsite ${domain}:\n${site.text}`,
    )).trim();
    if (/^UNKNOWN\b/i.test(summary)) summary = null;
  }
  await db.query(
    `INSERT INTO bi_crm_web_profiles (domain, summary, fetched_at) VALUES ($1, $2, now())
     ON CONFLICT (domain) DO UPDATE SET summary = EXCLUDED.summary, fetched_at = now()`,
    [domain, summary],
  );
  return summary;
}

async function facts(db: Q, entity: "contact" | "company", id: string) {
  if (entity === "contact") {
    const row = (await db.query(
      `SELECT c.full_name, c.email, c.title, c.tags, c.outreach_status, co.legal_name, co.website, co.domain, co.email AS company_email, co.industry,
              (SELECT count(*)::int FROM bi_applications a WHERE a.primary_contact_id = c.id) AS applications,
              (SELECT count(*)::int FROM bi_contact_activity x WHERE x.contact_id = c.id) AS activity
         FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id
        WHERE c.id = $1::uuid`,
      [id],
    )).rows[0];
    if (!row) return null;
    return { row, website: row.website || row.domain, emails: [row.email, row.company_email] };
  }
  const row = (await db.query(
    `SELECT co.legal_name, co.operating_name, co.industry, co.city, co.province, co.website, co.domain, co.email, co.tags,
            (SELECT array_agg(c.email) FROM bi_contacts c WHERE c.company_id = co.id AND c.email IS NOT NULL) AS contact_emails,
            (SELECT count(*)::int FROM bi_applications a WHERE a.company_id = co.id) AS applications,
            (SELECT count(*)::int FROM bi_contacts c WHERE c.company_id = co.id) AS people,
            (SELECT count(*)::int FROM bi_company_activity x WHERE x.company_id = co.id) AS activity
       FROM bi_companies co WHERE co.id = $1::uuid`,
    [id],
  )).rows[0];
  if (!row) return null;
  return { row, website: row.website || row.domain, emails: [row.email, ...(Array.isArray(row.contact_emails) ? row.contact_emails : [])] };
}

async function companyPrompt(db: Q, id: string, row: any, business: string | null): Promise<string> {
  const apps = (await db.query(`SELECT stage::text AS stage, status, created_at FROM bi_applications WHERE company_id = $1::uuid ORDER BY created_at DESC LIMIT 10`, [id])).rows;
  const activity = (await db.query(`SELECT occurred_at, event_type, outcome, body FROM bi_company_activity WHERE company_id = $1::uuid ORDER BY occurred_at DESC LIMIT 40`, [id])).rows;
  const lines = [
    `Company: ${row.legal_name ?? "Unknown"}${row.operating_name ? ` (o/a ${row.operating_name})` : ""}`,
    `Industry: ${row.industry ?? "unknown"}; location: ${[row.city, row.province].filter(Boolean).join(", ") || "unknown"}`,
    `Company website says: ${business ?? "not available"}`,
    `Applications: ${apps.length ? apps.map((a: any) => `${a.stage ?? "unknown"}${a.status ? ` (${a.status})` : ""} since ${String(a.created_at).slice(0, 10)}`).join("; ") : "none"}`,
    "Recent activity, newest first:",
    ...activity.map((a: any) => `- ${String(a.occurred_at).slice(0, 16)} ${a.event_type ?? "activity"}${a.outcome ? ` [${a.outcome}]` : ""}: ${String(a.body ?? "").replace(/\s+/g, " ").slice(0, 240)}`),
  ];
  if (!activity.length) lines.push("- none recorded");
  return lines.join("\n");
}

export type SummaryDeps = {
  model: Model | null;
  contactSummary: (id: string) => Promise<{ summary: string } | { error: string; status: number }>;
  fetchText?: typeof fetchSiteText;
};

export async function generateSummary(db: Q, deps: SummaryDeps, entity: "contact" | "company", id: string, userId: string | null): Promise<SummaryPayload | { error: string; status: number }> {
  const f = await facts(db, entity, id);
  if (!f) return { error: "not_found", status: 404 };
  if (!deps.model) return { error: "ai_not_configured", status: 503 };
  const sources: SummarySource[] = [];
  const site = websiteFor(f.website, f.emails);
  let business: string | null = null;
  if (site) {
    business = await websiteBackground(db, deps.model, site.host, deps.fetchText).catch((err) => {
      logger.warn({ err, host: site.host }, "bi_crm_ai_summary_website_failed");
      return null;
    });
    sources.push({ type: "website", label: site.host, url: `https://${site.host}/`, detail: site.from === "email" ? "Domain of a work email" : "Company website", status: business ? "used" : "unavailable" });
  } else {
    sources.push({ type: "website", label: "No company website", detail: "No website or work email on file (free email providers are skipped)", status: "skipped" });
  }
  for (const [key, label] of [["applications", "Applications"], ["activity", "Timeline activity"], ["people", "People at the company"]] as const) {
    const n = Number((f.row as any)[key] ?? 0);
    if (n > 0) sources.push({ type: key, label, detail: String(n), status: "used" });
  }
  sources.push({ type: "profile", label: entity === "contact" ? "Contact record" : "Company record", status: "used" });
  let summary: string;
  if (entity === "contact") {
    const r = await deps.contactSummary(id);
    if ("error" in r) return r;
    summary = r.summary;
    if (business) summary = `Business: ${business}\n\n${summary}`;
  } else {
    summary = (await deps.model(await companyPrompt(db, id, f.row, business))).trim() || "No summary returned.";
  }
  const generatedAt = new Date().toISOString();
  await db.query(
    `INSERT INTO bi_crm_ai_summaries (entity, entity_id, summary, business, sources, generated_at, generated_by)
     VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (entity, entity_id) DO UPDATE SET summary = EXCLUDED.summary, business = EXCLUDED.business,
       sources = EXCLUDED.sources, generated_at = EXCLUDED.generated_at, generated_by = EXCLUDED.generated_by`,
    [entity, id, summary, business, JSON.stringify(sources), generatedAt, userId],
  );
  return { summary, business, sources, generatedAt, cached: false };
}
