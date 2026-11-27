// BI_SERVER_FLOWS_AUTO_ADD_v1 - who a flow is for, and adding them. A running flow now picks up new matching people on its
// own (the flow worker calls addRunningAudiences every hour), so nobody has to press "Add the people" after each import.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

const US_SQL = `(lower(btrim(coalesce(c.country, ''))) IN ('us', 'usa', 'united states', 'united states of america')
  OR EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'us %'))`;
/** Who a flow is for: people tagged lender (or bank) / broker, in the flow's country, with an email we may still write to. */
export function audienceSql(market: string): string {
  const marketSql = market === "US" ? `AND ${US_SQL}` : market === "CA" ? `AND NOT ${US_SQL}` : "";
  return `
    FROM bi_contacts c
   WHERE c.email IS NOT NULL AND position('@' in c.email) > 1
     AND COALESCE(c.outreach_excluded, false) = false
     AND EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE $1 || '%'
                 -- BI_SERVER_BANKS_IN_LENDER_FLOWS_v1 - Todd: banks get the lender emails too.
                 OR ($1 = 'lender' AND lower(btrim(t)) LIKE 'bank%'))
     ${marketSql}
     AND NOT EXISTS (SELECT 1 FROM bi_suppressions s
                      WHERE (lower(s.email) = lower(c.email) OR lower(s.identifier) = lower(c.email) OR s.contact_id = c.id) AND s.channel IN ('email', 'all'))`;
}

/** Add everyone who matches a flow and is not in it yet; returns how many were added. */
export async function addFlowAudience(db: Db, flowId: string, audience: string, market: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO bi_flow_members (flow_id, contact_id, email)
     SELECT DISTINCT ON (lower(c.email)) $2::uuid, c.id, lower(btrim(c.email)) ${audienceSql(market)}
        AND NOT EXISTS (SELECT 1 FROM bi_flow_members m WHERE m.flow_id = $2 AND lower(m.email) = lower(btrim(c.email)))
      ORDER BY lower(c.email), c.created_at
     ON CONFLICT (flow_id, contact_id) DO NOTHING`,
    [audience, flowId],
  );
  return r.rowCount ?? 0;
}

/** Every running flow picks up the new people who match it. */
export async function addRunningAudiences(db: Db): Promise<number> {
  const flows = await db.query(`SELECT id::text AS id, audience, market FROM bi_flows WHERE status = 'active'`);
  let added = 0;
  for (const f of flows.rows) added += await addFlowAudience(db, f.id, f.audience, f.market);
  return added;
}
