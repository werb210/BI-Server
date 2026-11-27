// BI_SERVER_ENGAGEMENT_v1 - every five minutes: bring the PGI outreach stages up to date, give new follow-ups an owner,
// and make a task for each new reply or booking. One instance at a time (advisory lock).
import type { Pool } from "pg";
import { pool as defaultPool } from "../db";
import { logger } from "../platform/logger";
import { createFollowUpTasks, syncEngagement } from "../services/engagement/engagement";
import { createTask } from "./marketingWorker";
import { reclassifyRobotClicks } from "../services/flows/robotClicks"; // BI_SERVER_ROBOT_CLICKS_v2

const LOCK_KEY = 74_120_031;
let timer: NodeJS.Timeout | null = null;
let busy = false;

export async function runEngagementTick(db: Pick<Pool, "query">): Promise<Record<string, number>> {
  const robots = await reclassifyRobotClicks(db); // once: drops scanner clicks recorded before the stricter rule
  const sync = await syncEngagement(db);
  const tasks = await createFollowUpTasks(db, (owner, title, notes) => createTask(owner, title, notes));
  return { ...sync, tasks, robot_clicks_removed: robots.removed };
}

async function tick(pool: Pool): Promise<void> {
  if (busy) return;
  busy = true;
  const client = await pool.connect().catch(() => null);
  if (!client) { busy = false; return; }
  try {
    const lock = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!lock.rows[0]?.ok) return;
    try {
      const r = await runEngagementTick(client);
      if (Object.values(r).some((n) => n > 0)) logger.info(r, "engagement.worker.tick");
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "engagement.worker.tick_failed");
  } finally {
    client.release();
    busy = false;
  }
}

export function startEngagementWorker(pool: Pool = defaultPool as unknown as Pool): void {
  if (timer) return;
  timer = setInterval(() => { void tick(pool); }, 5 * 60_000);
  timer.unref();
  setTimeout(() => { void tick(pool); }, 45_000).unref();
}
