// BI_SERVER_PERSON_NAMES_v1 - once: contacts whose name is really a job title or a placeholder (see services/personName)
// get the title moved to their title and the company's name as their display name, with no first name, so the CRM
// stops showing "Dir." as a person and emails greet them as "there". "Name, Title" rows are split.
import type { Pool } from "pg";
import { logger } from "../platform/logger";
import { splitNameTitle } from "../services/personName";

const JOB = "clean_title_names_v1";
type Q = Pick<Pool, "query">;

export async function cleanTitleNames(db: Q): Promise<{ checked: number; renamed: number; no_person: number; skipped?: string }> {
  const claim = await db.query(`INSERT INTO bi_one_time_jobs (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name`, [JOB]);
  if (!claim.rowCount) return { checked: 0, renamed: 0, no_person: 0, skipped: "already_done" };
  const rows = await db.query(
    `SELECT c.id, c.full_name, c.title, c.email, coalesce(nullif(btrim(co.legal_name), ''), nullif(btrim(c.organization_name), '')) AS company
       FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id`);
  let renamed = 0, noPerson = 0;
  for (const r of rows.rows as Array<{ id: string; full_name: string; title: string | null; email: string | null; company: string | null }>) {
    const { name, title } = splitNameTitle(r.full_name, r.title);
    if (name === String(r.full_name ?? "").replace(/\s+/g, " ").trim() && (title ?? null) === (r.title ?? null)) continue;
    if (name) {
      const parts = name.split(/\s+/);
      await db.query(`UPDATE bi_contacts SET full_name = $2, first_name = $3, last_name = $4, title = $5, updated_at = now() WHERE id = $1`,
        [r.id, name, parts[0], parts.slice(1).join(" ") || null, title]);
      renamed++;
    } else {
      await db.query(`UPDATE bi_contacts SET full_name = $2, first_name = NULL, last_name = NULL, title = $3,
          organization_name = coalesce(nullif(btrim(organization_name), ''), $4), updated_at = now() WHERE id = $1`,
        [r.id, r.company ?? r.email ?? "(no name)", title, r.company]);
      noPerson++;
    }
  }
  const result = { checked: rows.rowCount ?? 0, renamed, no_person: noPerson };
  await db.query(`UPDATE bi_one_time_jobs SET done_at = now(), result = $2::jsonb WHERE name = $1`, [JOB, JSON.stringify(result)]);
  logger.info(result, "clean_title_names.done");
  return result;
}

export function startCleanTitleNames(pool: Q): void {
  const t = setTimeout(() => { void cleanTitleNames(pool).catch((err) => logger.warn({ err: (err as Error)?.message }, "clean_title_names.crashed")); }, 30_000);
  t.unref?.();
}
