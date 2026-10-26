// BI_SERVER_v856_CRM_UNIFY - merge duplicate BI companies (same behaviour as BF-Server v856). One transaction: every
// table with a company_id / converted_to_company_id column (found at run time) is re-pointed from each loser to the
// survivor (rows that would break a unique index are dropped and kept in the log), the survivor keeps the values staff
// chose, fills anything still empty from the losers, tags are unioned, hand-made people move over, the losers are
// deleted. bi_company_merges keeps a snapshot of each loser.
import type { PoolClient } from "pg";
import { COMPANY_MERGE_FIELDS, pickFieldChoices } from "./duplicates";
import { normalizeTags } from "./tags";

const qi = (id: string) => `"${id.replace(/"/g, '""')}"`;
const REF_COLUMNS = ["company_id", "converted_to_company_id"];

async function refColumns(client: Pick<PoolClient, "query">): Promise<Array<{ table: string; column: string }>> {
  const r = await client.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = ANY($1::text[]) AND c.data_type = 'uuid'
        AND c.table_name NOT IN ('bi_companies', 'bi_crm_company_people', 'bi_crm_company_people_hidden', 'bi_company_merges')
      ORDER BY c.table_name, c.column_name`,
    [REF_COLUMNS],
  );
  return r.rows.map((x) => ({ table: x.table_name, column: x.column_name }));
}

async function uniqueSets(client: Pick<PoolClient, "query">, table: string, column: string): Promise<Array<{ cols: string[]; pred: string }>> {
  const r = await client.query<{ cols: unknown; pred: string | null }>(
    `SELECT array_agg(a.attname::text ORDER BY k.ord)::text[] AS cols,
            COALESCE(pg_get_expr(i.indpred, i.indrelid, true), 'true') AS pred
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE i.indisunique AND i.indexprs IS NULL AND n.nspname = 'public' AND t.relname = $1
      GROUP BY i.indexrelid, i.indpred, i.indrelid
     HAVING $2::text = ANY(array_agg(a.attname::text))`,
    [table, column],
  );
  return r.rows.map((x) => ({
    cols: Array.isArray(x.cols) ? x.cols.map(String) : String(x.cols ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean),
    pred: String(x.pred ?? "true"),
  })).filter((x) => x.cols.length > 0);
}

export function collisionSql(table: string, column: string, cols: string[], pred: string): string {
  const others = cols.filter((c) => c !== column).map((c) => ` AND s.${qi(c)} IS NOT DISTINCT FROM lr.${qi(c)}`).join("");
  const only = pred && pred.trim() && pred.trim() !== "true" ? ` AND (${pred})` : "";
  return `WITH survivor_rows AS (SELECT * FROM ${qi(table)} WHERE ${qi(column)} = $1::uuid${only}),
    loser_rows AS (SELECT ctid AS bi_merge_ctid, * FROM ${qi(table)} WHERE ${qi(column)} = $2::uuid${only})
    DELETE FROM ${qi(table)} l USING loser_rows lr
     WHERE l.ctid = lr.bi_merge_ctid AND EXISTS (SELECT 1 FROM survivor_rows s WHERE true${others})
    RETURNING l.*`;
}

const FILL = ["operating_name", "business_number", "address_line1", "city", "province", "postal_code", "industry", "email",
  "phone", "website", "country", "entity_type", "time_in_business", "domain"];

export async function mergeCompanies(client: PoolClient, opts: { survivorId: string; loserIds: string[]; fields?: unknown; userId: string | null }) {
  const { survivorId } = opts;
  const loserIds = Array.from(new Set(opts.loserIds.filter((x) => x && x !== survivorId)));
  if (!loserIds.length) throw Object.assign(new Error("choose at least one other company"), { status: 400 });
  const all = await client.query(`SELECT * FROM bi_companies WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[survivorId, ...loserIds]]);
  const survivor = all.rows.find((r: any) => String(r.id) === survivorId);
  if (!survivor) throw Object.assign(new Error("company not found"), { status: 404 });
  const losers = loserIds.map((id) => all.rows.find((r: any) => String(r.id) === id));
  if (losers.some((x) => !x)) throw Object.assign(new Error("a company to merge was not found"), { status: 404 });
  const moved: Record<string, number> = {};
  const refs = await refColumns(client);
  for (const loser of losers as any[]) {
    const loserId = String(loser.id);
    const dropped: Record<string, unknown[]> = {};
    for (const { table, column } of refs) {
      for (const idx of await uniqueSets(client, table, column)) {
        const d = await client.query(collisionSql(table, column, idx.cols, idx.pred), [survivorId, loserId]);
        if ((d.rowCount ?? 0) > 0) { dropped[table] = [...(dropped[table] ?? []), ...d.rows]; moved[`${table}:deduped`] = (moved[`${table}:deduped`] ?? 0) + (d.rowCount ?? 0); }
      }
      const r = await client.query(`UPDATE ${qi(table)} SET ${qi(column)} = $1::uuid WHERE ${qi(column)} = $2::uuid`, [survivorId, loserId]);
      if ((r.rowCount ?? 0) > 0) moved[`${table}.${column}`] = (moved[`${table}.${column}`] ?? 0) + (r.rowCount ?? 0);
    }
    const people = await client.query(
      `UPDATE bi_crm_company_people p SET company_id = $1::uuid
        WHERE p.company_id = $2::uuid AND NOT EXISTS (SELECT 1 FROM bi_crm_company_people q WHERE q.company_id = $1::uuid AND q.contact_id = p.contact_id)`,
      [survivorId, loserId],
    );
    if ((people.rowCount ?? 0) > 0) moved.bi_crm_company_people = (moved.bi_crm_company_people ?? 0) + (people.rowCount ?? 0);
    await client.query(
      `INSERT INTO bi_company_merges (survivor_id, loser_id, moved, loser_snapshot, merged_by) VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5)`,
      [survivorId, loserId, JSON.stringify(moved), JSON.stringify({ company: loser, dropped }), opts.userId],
    );
  }
  const merged: Record<string, unknown> = {};
  for (const [k, v] of pickFieldChoices(COMPANY_MERGE_FIELDS, [survivor, ...losers], opts.fields)) merged[k] = v;
  for (const col of [...FILL, "start_date", "employees", "annual_revenue", "owner_id"]) {
    if (col in merged || !(col in survivor)) continue;
    const cur = survivor[col];
    if (cur != null && String(cur).trim() !== "") continue;
    const from = (losers as any[]).find((l) => l[col] != null && String(l[col]).trim() !== "");
    if (from) merged[col] = from[col];
  }
  merged.tags = normalizeTags([...(survivor.tags ?? []), ...(losers as any[]).flatMap((l) => l.tags ?? [])]);
  const keys = Object.keys(merged);
  await client.query(
    `UPDATE bi_companies SET ${keys.map((k, i) => `${qi(k)} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1::uuid`,
    [survivorId, ...keys.map((k) => merged[k])],
  );
  await client.query(`DELETE FROM bi_crm_company_people_hidden WHERE company_id = ANY($1::uuid[])`, [loserIds]);
  await client.query(`DELETE FROM bi_companies WHERE id = ANY($1::uuid[])`, [loserIds]);
  return { survivorId, loserIds, moved };
}
