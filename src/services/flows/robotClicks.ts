// BI_SERVER_ROBOT_CLICKS_v2 (2026-11-27) - Todd: the Clicked column must only hold real people. Bank mail filters click every
// link in an incoming email within minutes, so a click counts only when it came 5+ minutes after the email left, and, if
// they never opened it first, an hour or more after. This goes back over the clicks already recorded with the same rule
// (once): a member whose clicks were all scanners loses the click, and the pipeline row follows.
import { isRobotClick, isUnsubscribeUrl, parseFlowJobId, type Click } from "./flowEngine";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
const urlOf = (detail: unknown): string => { try { return String(JSON.parse(String(detail ?? "{}"))?.url ?? ""); } catch { return ""; } };

/** The first click that a person made, or null if every click looks like a scanner. */
export function firstRealClick(events: Array<{ job_id: string; event_type: string; at: Date; detail?: unknown }>): Date | null {
  const sentAt = new Map<string, Date>();
  for (const e of events) if (!sentAt.has(e.job_id) || e.at < sentAt.get(e.job_id)!) sentAt.set(e.job_id, e.at); // first event of each email
  const clicks: Click[] = events.filter((e) => e.event_type === "click").map((e) => ({ at: e.at, url: urlOf(e.detail) }));
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let opened = false;
  for (const e of sorted) {
    if (e.event_type === "open") { opened = true; continue; }
    if (e.event_type !== "click") continue;
    const click = { at: e.at, url: urlOf(e.detail) };
    if (isUnsubscribeUrl(click.url)) continue;
    // the email's own send time: its first logged event (processed / delivered) if any came before the click
    const sent = sentAt.get(e.job_id) ?? null;
    if (!isRobotClick(click, sent && sent < e.at ? sent : null, clicks, opened)) return e.at;
  }
  return null;
}

export async function reclassifyRobotClicks(db: Db): Promise<{ checked: number; removed: number }> {
  const done = await db.query(`SELECT 1 FROM bi_engagement_settings WHERE key = 'robot_clicks_v2'`);
  if (done.rowCount) return { checked: 0, removed: 0 };
  const members = await db.query(`SELECT id, flow_id::text AS flow_id, contact_id::text AS contact_id, opened_at FROM bi_flow_members WHERE clicked_at IS NOT NULL`);
  let removed = 0;
  for (const m of members.rows) {
    const ev = await db.query(
      `SELECT job_id, event_type, created_at AS at, detail FROM bi_marketing_send_events
        WHERE contact_id = $1 AND job_id LIKE 'flow:' || $2 || ':%' ORDER BY created_at`, [m.contact_id, m.flow_id]);
    const events = ev.rows.filter((r) => parseFlowJobId(r.job_id)).map((r) => ({ job_id: String(r.job_id), event_type: String(r.event_type), at: new Date(r.at), detail: r.detail }));
    const real = firstRealClick(events);
    if (real) { await db.query(`UPDATE bi_flow_members SET clicked_at = $2 WHERE id = $1 AND clicked_at IS DISTINCT FROM $2`, [m.id, real]); continue; }
    await db.query(
      `UPDATE bi_flow_members SET clicked_at = NULL, track = CASE WHEN opened_at IS NOT NULL THEN 'opened' ELSE 'none' END, updated_at = now() WHERE id = $1`, [m.id]);
    removed += 1;
  }
  // The pipeline rows follow: their click is the earliest real one across their flows, or none.
  await db.query(
    `UPDATE bi_engagement e SET clicked_at = x.c, updated_at = now()
       FROM (SELECT contact_id, min(clicked_at) AS c FROM bi_flow_members GROUP BY contact_id) x
      WHERE e.contact_id = x.contact_id AND e.clicked_at IS DISTINCT FROM x.c`);
  await db.query(`INSERT INTO bi_engagement_settings (key, value) VALUES ('robot_clicks_v2', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ checked: members.rows.length, removed, at: new Date().toISOString() })]);
  return { checked: members.rows.length, removed };
}
