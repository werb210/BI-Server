// BI_SERVER_MOVE_BRM_UNSUBSCRIBES_v1 (Todd, 2026-11-25: yes) - people who unsubscribed from a Boreal Risk Management email
// before BRM had its own SendGrid unsubscribe group were put on the account-wide list, which blocks Keystone and Boreal
// Financial mail too. Once, for each BRM unsubscribe that is also on SendGrid's account-wide list: put the address on the
// Boreal Risk Management group (they stay unsubscribed from BRM), take it off the account-wide list, and ask BF-Server to
// mark its copy as a BRM-only unsubscribe and lift the Keystone / Boreal Financial opt-outs it caused. Bounces and spam
// reports are not touched.
import type { Pool } from "pg";
import { logger } from "../platform/logger";
import { brmUnsubscribeGroup } from "../services/biSendgridService";

const JOB = "move_brm_unsubscribes_v1";
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
type Q = Pick<Pool, "query">;
export type MoveDeps = { fetch: FetchLike; apiKey: string | undefined; bfUrl: string; serviceToken: string; group: () => Promise<number | null> };

const UNSUB_REASONS = ["unsubscribe", "sendgrid_unsubscribe", "sendgrid_group_unsubscribe", "group_unsubscribe"];

export async function moveBrmUnsubscribes(db: Q, deps: MoveDeps): Promise<{ checked: number; moved: string[]; skipped?: string }> {
  const claim = await db.query(`INSERT INTO bi_one_time_jobs (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name`, [JOB]);
  if (!claim.rowCount) return { checked: 0, moved: [], skipped: "already_done" };
  const finish = async (result: Record<string, unknown>) => {
    await db.query(`UPDATE bi_one_time_jobs SET done_at = now(), result = $2::jsonb WHERE name = $1`, [JOB, JSON.stringify(result)]);
  };
  const group = await deps.group();
  if (!deps.apiKey || !group) {
    // Leave it unclaimed so it runs again once SendGrid is set up.
    await db.query(`DELETE FROM bi_one_time_jobs WHERE name = $1`, [JOB]);
    return { checked: 0, moved: [], skipped: "no_group" };
  }
  const rows = await db.query(
    `SELECT DISTINCT lower(btrim(coalesce(email, identifier))) AS email FROM bi_suppressions
      WHERE channel IN ('email', 'all') AND reason = ANY($1::text[]) AND position('@' in coalesce(email, identifier, '')) > 1`,
    [UNSUB_REASONS],
  );
  const headers = { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" };
  const moved: string[] = [];
  for (const { email } of rows.rows as Array<{ email: string }>) {
    try {
      const g = await deps.fetch(`https://api.sendgrid.com/v3/asm/suppressions/global/${encodeURIComponent(email)}`, { headers });
      const body = g.ok ? await g.json().catch(() => ({})) : {};
      if (!body?.recipient_email) continue; // not on the account-wide list
      const add = await deps.fetch(`https://api.sendgrid.com/v3/asm/groups/${group}/suppressions`, { method: "POST", headers, body: JSON.stringify({ recipient_emails: [email] }) });
      if (!add.ok) { logger.warn({ email, status: add.status }, "brm_unsub_move.group_add_failed"); continue; }
      const del = await deps.fetch(`https://api.sendgrid.com/v3/asm/suppressions/global/${encodeURIComponent(email)}`, { method: "DELETE", headers });
      if (!del.ok && del.status !== 404) { logger.warn({ email, status: del.status }, "brm_unsub_move.global_delete_failed"); continue; }
      moved.push(email);
    } catch (err) {
      logger.warn({ email, err: (err as Error)?.message }, "brm_unsub_move.failed");
    }
  }
  const bf = moved.length ? await tellBf(deps, moved) : { ok: true };
  const result = { checked: rows.rowCount ?? 0, moved, bf };
  if (bf.ok) await finish(result);
  else await db.query(`UPDATE bi_one_time_jobs SET result = $2::jsonb WHERE name = $1`, [JOB, JSON.stringify(result)]); // retried hourly
  logger.info({ checked: result.checked, moved: moved.length, bf }, "brm_unsub_move.done");
  return { checked: rows.rowCount ?? 0, moved };
}

async function tellBf(deps: MoveDeps, emails: string[]): Promise<{ ok: boolean; [k: string]: unknown }> {
  try {
    const r = await deps.fetch(`${deps.bfUrl.replace(/\/+$/, "")}/api/service/suppressions/brand-only`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Backend-Token": deps.serviceToken, "X-Silo": "BI" },
      body: JSON.stringify({ brand: "BI", emails }),
    });
    return r.ok ? { ok: true, ...(await r.json().catch(() => ({}))) } : { ok: false, status: r.status };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message };
  }
}

/** BF-Server may not have the endpoint yet (it is swapped separately): keep telling it until it answers. */
export async function retryBfNotice(db: Q, deps: MoveDeps): Promise<boolean> {
  const r = await db.query(`SELECT result FROM bi_one_time_jobs WHERE name = $1 AND done_at IS NULL`, [JOB]);
  const moved: string[] = Array.isArray(r.rows[0]?.result?.moved) ? r.rows[0].result.moved : [];
  if (!moved.length) return false;
  const bf = await tellBf(deps, moved);
  if (!bf.ok) return false;
  await db.query(`UPDATE bi_one_time_jobs SET done_at = now(), result = result || jsonb_build_object('bf', $2::jsonb) WHERE name = $1`, [JOB, JSON.stringify(bf)]);
  logger.info({ moved: moved.length, bf }, "brm_unsub_move.bf_told");
  return true;
}

export function startBrmUnsubscribeMove(pool: Q): void {
  const deps = (): MoveDeps => ({
    fetch: fetch as unknown as FetchLike,
    apiKey: process.env.BI_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY,
    bfUrl: process.env.BF_SERVER_URL || "https://server.boreal.financial",
    serviceToken: (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim(),
    group: () => brmUnsubscribeGroup(),
  });
  const log = (err: unknown) => logger.warn({ err: (err as Error)?.message }, "brm_unsub_move.crashed");
  const first = setTimeout(() => { void moveBrmUnsubscribes(pool, deps()).catch(log); }, 3 * 60_000);
  const retry = setInterval(() => { void retryBfNotice(pool, deps()).catch(log); }, 60 * 60_000);
  first.unref?.();
  retry.unref?.();
}
