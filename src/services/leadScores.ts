// BI_SERVER_LEAD_SCORES_v1 - lead scores for Insurance contacts, the same scale, rules and grades as BF-Server v874
// (hot 70+, warm 40+): a phone (+10), a company (+5), an owner/officer title (+10), the website_form tag (+10), PGI
// coverage asked of $50,000 or more (+10), plus engagement from BI's own data - sequence email opens (+2 each, max 20),
// clicks (+5 each, max 25), replies (+15, max 15), an application started (+20) and moved past the first stage (+30).
// Computed on request for the contacts on screen; nothing is stored.
export type LeadScore = { score: number; grade: "hot" | "warm" | "cold"; breakdown: Array<{ label: string; points: number }> };
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const OWNER_TITLE = /\b(owner|founder|co-?founder|president|ceo|principal|partner|director|managing)\b/i;
const cap = (n: number, each: number, max: number) => Math.min(max, Math.max(0, n) * each);

export function scoreOne(c: {
  phone_e164?: string | null; company_id?: string | null; title?: string | null; tags?: string[] | null;
  max_coverage?: number | string | null; opens?: number; clicks?: number; replies?: number; apps?: number; apps_moved?: number;
}): LeadScore {
  const parts: Array<{ label: string; points: number }> = [];
  const add = (label: string, points: number) => { if (points) parts.push({ label, points }); };
  add("Has a phone number", c.phone_e164 ? 10 : 0);
  add("Has a company", c.company_id ? 5 : 0);
  add("Owner or officer title", c.title && OWNER_TITLE.test(c.title) ? 10 : 0);
  add("Came from a website form", (c.tags ?? []).some((t) => String(t).toLowerCase().replace(/[\s-]+/g, "_") === "website_form") ? 10 : 0);
  add("Coverage of $50,000 or more", Number(c.max_coverage ?? 0) >= 50000 ? 10 : 0);
  add(`Email opens (${c.opens ?? 0})`, cap(Number(c.opens ?? 0), 2, 20));
  add(`Email clicks (${c.clicks ?? 0})`, cap(Number(c.clicks ?? 0), 5, 25));
  add("Replied", Number(c.replies ?? 0) > 0 ? 15 : 0);
  add("Started an application", Number(c.apps ?? 0) > 0 ? 20 : 0);
  add("Application in progress", Number(c.apps_moved ?? 0) > 0 ? 30 : 0);
  const score = Math.max(0, Math.min(100, parts.reduce((t, p) => t + p.points, 0)));
  return { score, grade: score >= 70 ? "hot" : score >= 40 ? "warm" : "cold", breakdown: parts };
}

export async function lookupLeadScores(db: Q, ids: string[]): Promise<Record<string, LeadScore>> {
  const clean = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 500);
  if (!clean.length) return {};
  const r = await db.query(
    `SELECT c.id::text AS id, c.phone_e164, c.company_id::text AS company_id, c.title, c.tags,
            (SELECT max(a.coverage_amount) FROM bi_applications a WHERE a.primary_contact_id = c.id) AS max_coverage,
            (SELECT count(*) FROM bi_applications a WHERE a.primary_contact_id = c.id)::int AS apps,
            (SELECT count(*) FROM bi_applications a WHERE a.primary_contact_id = c.id AND a.stage::text <> 'new_application')::int AS apps_moved,
            (SELECT count(*) FILTER (WHERE e.event_type = 'opened') FROM bi_sequence_events e JOIN bi_sequence_enrollments en ON en.id = e.enrollment_id WHERE en.contact_id = c.id)::int AS opens,
            (SELECT count(*) FILTER (WHERE e.event_type = 'clicked') FROM bi_sequence_events e JOIN bi_sequence_enrollments en ON en.id = e.enrollment_id WHERE en.contact_id = c.id)::int AS clicks,
            (SELECT count(*) FILTER (WHERE e.event_type = 'replied') FROM bi_sequence_events e JOIN bi_sequence_enrollments en ON en.id = e.enrollment_id WHERE en.contact_id = c.id)::int AS replies
       FROM bi_contacts c WHERE c.id = ANY($1::uuid[])`,
    [clean],
  );
  return Object.fromEntries(r.rows.map((row: any) => [String(row.id), scoreOne(row)]));
}
