// BI_SERVER_EMAIL_FLOWS_v1 - runs the email flows (services/flows/flowEngine.ts has the rules).
// Every minute: read new opens and clicks, ask for a call on a real click, start today's new people, send what is due.
// Both deployment slots run this worker, so a tick only works while it holds a database advisory lock.
import type { Pool, PoolClient } from "pg";
import { pool as defaultPool } from "../db";
import { logger } from "../platform/logger";
import { isSendableAt } from "../services/sequenceSchedule";
import { mergeFields, sendBiMarketingEmail, sendgridConfigured } from "../services/biSendgridService";
import {
  FLOW_WINDOW, dailyNewCap, flowJobId, htmlToText, isFlowKey, nextAfterSend, onClick, onOpen, parseFlowJobId, withFooter,
  type Click, type FlowKey, type Track,
} from "../services/flows/flowEngine";
import { createTask } from "./marketingWorker";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export type FlowDeps = {
  send: (m: { to: string; subject: string; html: string; text: string; fromName: string; replyTo?: string; customArgs: Record<string, string> }) => Promise<unknown>;
  task: (assigneeUserId: string, title: string, notes: string) => Promise<{ ok: boolean; error?: string }>;
};
const liveDeps: FlowDeps = {
  send: (m) => sendBiMarketingEmail(m),
  task: (assignee, title, notes) => createTask(assignee, title, notes),
};
const LOCK_KEY = 772_031_951; // any fixed number; only this worker uses it
const MAX_FAILURES = 3;
const SENDS_PER_TICK = 60;
/** People who have had their last email still move up on an open or click for this long. */
const LISTEN_DAYS = 30;

type MemberRow = {
  id: string; flow_id: string; contact_id: string; email: string; status: string; track: Track; sent_keys: string[];
  last_sent_at: Date | null; next_key: string | null;
};

/** Opens and clicks that arrived since each person was last looked at. */
export async function ingestEvents(db: Db): Promise<{ opened: number; clicked: number }> {
  const r = await db.query(
    `SELECT m.id, m.flow_id, m.contact_id, m.email, m.status, m.track, m.sent_keys, m.last_sent_at, m.next_key,
            ev.event_type, ev.created_at AS ev_at, ev.detail, ev.job_id
       FROM bi_marketing_send_events ev
       JOIN bi_flow_members m ON m.contact_id::text = ev.contact_id AND ev.job_id LIKE 'flow:' || m.flow_id::text || ':%'
      WHERE ev.event_type IN ('open', 'click') AND ev.created_at > m.events_seen_at
        AND m.track <> 'clicked'
        AND (m.status = 'active' OR (m.status = 'done' AND m.last_sent_at > now() - interval '${LISTEN_DAYS} days'))
      ORDER BY ev.created_at
      LIMIT 1000`,
  );
  const state = new Map<string, MemberRow>();
  const clicksBy = new Map<string, Click[]>();
  const urlOf = (detail: unknown): string => { try { return String(JSON.parse(String(detail ?? "{}"))?.url ?? ""); } catch { return ""; } };
  for (const row of r.rows) {
    if (row.event_type === "click") {
      const list = clicksBy.get(row.id) ?? [];
      list.push({ at: new Date(row.ev_at), url: urlOf(row.detail) });
      clicksBy.set(row.id, list);
    }
  }
  let opened = 0;
  let clicked = 0;
  for (const row of r.rows) {
    if (!parseFlowJobId(row.job_id)) continue;
    const m: MemberRow = state.get(row.id) ?? { ...row, sent_keys: row.sent_keys ?? [], last_sent_at: row.last_sent_at ? new Date(row.last_sent_at) : null };
    state.set(row.id, m);
    const at = new Date(row.ev_at);
    const cur = { track: m.track, sentKeys: m.sent_keys, lastSentAt: m.last_sent_at };
    const change = row.event_type === "click"
      ? onClick(cur, { at, url: urlOf(row.detail) }, clicksBy.get(row.id) ?? [])
      : onOpen(cur, at);
    if (!change) {
      await db.query(`UPDATE bi_flow_members SET events_seen_at = GREATEST(events_seen_at, $2) WHERE id = $1`, [m.id, at]);
      continue;
    }
    const isClick = change.track === "clicked";
    await db.query(
      `UPDATE bi_flow_members
          SET track = $2, events_seen_at = GREATEST(events_seen_at, $3), updated_at = now(),
              opened_at = COALESCE(opened_at, $3), clicked_at = CASE WHEN $4 THEN COALESCE(clicked_at, $3) ELSE clicked_at END,
              next_key = COALESCE($5, next_key), next_at = COALESCE($6, next_at), status = CASE WHEN $5::text IS NULL THEN status ELSE 'active' END
        WHERE id = $1`,
      [m.id, change.track, at, isClick, change.next?.key ?? null, change.next?.at ?? null],
    );
    m.track = change.track;
    if (isClick) clicked += 1; else opened += 1;
  }
  return { opened, clicked };
}

/** One call task per person who really clicked, for the flow's owner. */
export async function createCallTasks(db: Db, deps: FlowDeps): Promise<number> {
  const r = await db.query(
    `UPDATE bi_flow_members m SET task_created_at = now()
       FROM bi_flows f, bi_contacts c
      WHERE m.flow_id = f.id AND c.id = m.contact_id AND m.track = 'clicked' AND m.task_created_at IS NULL AND m.failures < ${MAX_FAILURES}
      RETURNING m.id, m.contact_id, f.name AS flow_name, f.owner_user_id, c.full_name, c.organization_name, c.email, c.phone_e164`,
  );
  let made = 0;
  for (const row of r.rows) {
    const who = [row.full_name, row.organization_name].filter(Boolean).join(", ");
    await db.query(
      `INSERT INTO bi_contact_activity (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, NULL, 'Email flow', 'note', 'clicked', $2, $3::jsonb)`,
      [row.contact_id, `Clicked a link in the "${row.flow_name}" emails. Call them.`, JSON.stringify({ flow_member_id: row.id })],
    ).catch((err: unknown) => logger.warn({ err: (err as Error)?.message, memberId: row.id }, "flow.worker.click_activity_failed"));
    if (!row.owner_user_id) { logger.warn({ memberId: row.id }, "flow.worker.no_owner_for_call_task"); continue; }
    const res = await deps.task(String(row.owner_user_id), `Call ${who || "a contact"} - clicked the ${row.flow_name} email`,
      `They clicked a link in the "${row.flow_name}" emails and have been sent the booking link.${row.phone_e164 ? ` Phone: ${row.phone_e164}.` : ""} Open the contact in Insurance > CRM.`);
    if (res.ok) { made += 1; continue; }
    logger.warn({ memberId: row.id, error: res.error }, "flow.worker.call_task_failed");
    await db.query(`UPDATE bi_flow_members SET task_created_at = NULL, failures = failures + 1 WHERE id = $1`, [row.id]);
  }
  return made;
}

/** Start today's share of the people still waiting, per flow. */
export async function startNewPeople(db: Db, now: Date): Promise<number> {
  const flows = await db.query(`SELECT id, daily_new, started_at FROM bi_flows WHERE status = 'active'`);
  let started = 0;
  for (const f of flows.rows) {
    const cap = dailyNewCap(Number(f.daily_new), f.started_at ? new Date(f.started_at) : null, now);
    const used = await db.query(
      `SELECT count(*)::int AS n FROM bi_flow_members
        WHERE flow_id = $1 AND status <> 'queued'
          AND (COALESCE(first_sent_at, updated_at) AT TIME ZONE 'America/Regina')::date = ($2::timestamptz AT TIME ZONE 'America/Regina')::date
          AND (first_sent_at IS NOT NULL OR next_key = 'e1')`,
      [f.id, now],
    );
    const room = cap - Number(used.rows[0]?.n ?? 0);
    if (room <= 0) continue;
    const r = await db.query(
      `UPDATE bi_flow_members SET status = 'active', next_key = 'e1', next_at = $2, events_seen_at = $2, updated_at = $2
        WHERE id IN (SELECT id FROM bi_flow_members WHERE flow_id = $1 AND status = 'queued' ORDER BY created_at, id LIMIT $3)`,
      [f.id, now, room],
    );
    started += r.rowCount ?? 0;
  }
  return started;
}

async function suppressed(db: Db, contactId: string, email: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM bi_suppressions
      WHERE (contact_id::text = $1 OR lower(email) = lower($2) OR lower(identifier) = lower($2)) AND channel IN ('all', 'email') LIMIT 1`,
    [contactId, email],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Send every email that is due, inside sending hours. */
export async function sendDue(db: Db, deps: FlowDeps, now: Date): Promise<{ sent: number; failed: number; stopped: number }> {
  const out = { sent: 0, failed: 0, stopped: 0 };
  if (!isSendableAt(now, FLOW_WINDOW)) return out;
  const due = await db.query(
    `SELECT m.id, m.flow_id, m.contact_id, m.email, m.track, m.next_key, m.failures,
            f.name AS flow_name, f.emails, f.from_name, f.reply_to, f.link_url, f.booking_url,
            c.first_name, c.full_name, c.organization_name, c.email AS contact_email
       FROM bi_flow_members m
       JOIN bi_flows f ON f.id = m.flow_id AND f.status = 'active'
       LEFT JOIN bi_contacts c ON c.id = m.contact_id
      WHERE m.status = 'active' AND m.next_key IS NOT NULL AND m.next_at <= $1
      ORDER BY m.next_at LIMIT ${SENDS_PER_TICK}`,
    [now],
  );
  const stop = async (id: string, reason: string) => {
    out.stopped += 1;
    await db.query(`UPDATE bi_flow_members SET status = 'stopped', stop_reason = $2, next_key = NULL, next_at = NULL, updated_at = now() WHERE id = $1`, [id, reason]);
  };
  for (const row of due.rows) {
    const key = row.next_key as string;
    const to = String(row.contact_email ?? "").trim();
    if (!to || !to.includes("@")) { await stop(row.id, "no_email"); continue; }
    if (await suppressed(db, row.contact_id, to)) { await stop(row.id, "unsubscribed_or_bounced"); continue; }
    const content = isFlowKey(key) ? (row.emails ?? {})[key] : null;
    if (!content?.subject || !content?.body) { await stop(row.id, "no_email_wording"); continue; }
    const full = String(row.full_name ?? "").trim();
    const merge = {
      first_name: String(row.first_name ?? "").trim() || full.split(/\s+/)[0] || "there",
      full_name: full, name: full, company: String(row.organization_name ?? "").trim() || "your firm",
      link: String(row.link_url ?? ""), booking_link: String(row.booking_url ?? ""), email: to,
    };
    const fromName = String(row.from_name ?? "").trim() || "Boreal Risk Management";
    const html = withFooter(mergeFields(String(content.body), merge), fromName);
    try {
      await deps.send({
        to, subject: mergeFields(String(content.subject), merge), html, text: htmlToText(html), fromName,
        replyTo: String(row.reply_to ?? "").trim() || undefined,
        customArgs: { job_id: flowJobId(row.flow_id, key as FlowKey), contact_id: String(row.contact_id) },
      });
    } catch (err) {
      out.failed += 1;
      logger.warn({ memberId: row.id, key, err: (err as Error)?.message }, "flow.worker.send_failed");
      if (Number(row.failures) + 1 >= MAX_FAILURES) await stop(row.id, "send_failed");
      else await db.query(`UPDATE bi_flow_members SET failures = failures + 1, next_at = $2 WHERE id = $1`, [row.id, new Date(now.getTime() + 15 * 60_000)]);
      continue;
    }
    const next = nextAfterSend(key as FlowKey, row.track as Track, now);
    await db.query(
      `UPDATE bi_flow_members
          SET sent_keys = array_append(sent_keys, $2), last_sent_at = $3, first_sent_at = COALESCE(first_sent_at, $3), failures = 0,
              next_key = $4, next_at = $5, status = CASE WHEN $4::text IS NULL THEN 'done' ELSE 'active' END, updated_at = $3
        WHERE id = $1`,
      [row.id, key, now, next?.key ?? null, next?.at ?? null],
    );
    await db.query(
      `INSERT INTO bi_contact_activity (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, NULL, 'Email flow', 'email', 'sent', $2, $3::jsonb)`,
      [row.contact_id, `${row.flow_name}: ${mergeFields(String(content.subject), merge)}`.slice(0, 1000), JSON.stringify({ flow_id: row.flow_id, key })],
    ).catch((err: unknown) => logger.warn({ err: (err as Error)?.message, memberId: row.id }, "flow.worker.activity_failed"));
    await db.query(
      `UPDATE bi_contacts SET outreach_status = 'contacted', outreach_updated_at = NOW()
        WHERE id = $1 AND COALESCE(outreach_status, 'new') IN ('new', 'cold', 'attempting', 'voicemail')`,
      [row.contact_id],
    ).catch(() => undefined);
    out.sent += 1;
  }
  return out;
}

export async function runFlowTick(db: Db, deps: FlowDeps, now = new Date()): Promise<Record<string, number>> {
  const events = await ingestEvents(db);
  const tasks = await createCallTasks(db, deps);
  const started = await startNewPeople(db, now);
  const sends = await sendDue(db, deps, now);
  return { ...events, tasks, started, ...sends };
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
async function tick(pool: Pool): Promise<void> {
  if (busy) return;
  busy = true;
  let client: PoolClient | null = null;
  try {
    const any = await pool.query(`SELECT 1 FROM bi_flows WHERE status = 'active' LIMIT 1`);
    if (!any.rowCount) return;
    client = await pool.connect();
    const lock = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!lock.rows[0]?.ok) return;
    try {
      const result = await runFlowTick(client, liveDeps);
      if (Object.values(result).some((n) => n > 0)) logger.info(result, "flow.worker.tick");
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "flow.worker.tick_failed");
  } finally {
    client?.release();
    busy = false;
  }
}
export function startFlowWorker(pool: Pool = defaultPool as unknown as Pool): void {
  if (timer) return;
  if (!sendgridConfigured()) logger.warn("flow.worker: SendGrid is not configured; flows will not send");
  timer = setInterval(() => { void tick(pool); }, 60_000);
  timer.unref();
}
