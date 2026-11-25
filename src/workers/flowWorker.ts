// BI_SERVER_EMAIL_FLOWS_v1 - runs the email flows (services/flows/flowEngine.ts has the rules).
// Every minute: read new opens and clicks, ask for a call on a real click, start today's new people, send what is due.
// Both deployment slots run this worker, so a tick only works while it holds a database advisory lock.
import type { Pool, PoolClient } from "pg";
import { pool as defaultPool } from "../db";
import { logger } from "../platform/logger";
import { isSendableAt } from "../services/sequenceSchedule";
import { biSendgridFrom, mergeFields, sendBiMarketingEmail, sendgridConfigured } from "../services/biSendgridService";
import {
  FLOW_WINDOW, dailyNewCap, endsFirstRoundUnopened, flowJobId, htmlToText, isFlowKey, nextAfterSend, onClick, onOpen, parseFlowJobId, secondAddressStartAt, withFooter,
  type Click, type FlowKey, type Track,
} from "../services/flows/flowEngine";
import { pgiMarketingHeld } from "../lib/pgiMarketingHold";
import { loadAttachments, type FlowAttachment } from "../services/flows/flowAttachments";
import { createTask } from "./marketingWorker";
import { addRunningAudiences } from "../services/flows/flowAudience"; // BI_SERVER_FLOWS_AUTO_ADD_v1

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export type FlowDeps = {
  send: (m: { to: string; subject: string; html: string; text: string; fromName: string; replyTo?: string; customArgs: Record<string, string>; attachments?: FlowAttachment[] }) => Promise<unknown>;
  /** BI_SERVER_FLOW_ATTACHMENTS_v1 - reads the collateral PDFs a flow email carries. */
  attachments?: (ids: unknown) => Promise<FlowAttachment[]>;
  task: (assigneeUserId: string, title: string, notes: string) => Promise<{ ok: boolean; error?: string }>;
  /** Who has emailed this mailbox since a time (BF-Server reads the connected Microsoft 365 mailbox). */
  replies?: (mailbox: string, since: Date) => Promise<{ connected: boolean; replies: FlowReply[] }>;
};
// BI_SERVER_AUTO_REPLY_REFERRALS_v1 - an auto-reply can say the person has left and name colleagues to contact instead.
export type FlowReply = { from: string; at: string; auto_reply?: boolean; left?: boolean; referrals?: Array<{ email: string; name: string | null; phone: string | null }> };
const liveDeps: FlowDeps = {
  send: (m) => sendBiMarketingEmail(m),
  attachments: (ids) => loadAttachments(ids),
  task: (assignee, title, notes) => createTask(assignee, title, notes),
  replies: async (mailbox, since) => {
    const base = process.env.BF_SERVER_URL || "https://server.boreal.financial";
    const token = (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim();
    const r = await fetch(`${base}/api/service/mail/replies?mailbox=${encodeURIComponent(mailbox)}&since=${encodeURIComponent(since.toISOString())}`,
      { headers: { "X-Backend-Token": token, "X-Silo": "BI" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`BF-Server replies ${r.status}`);
    const j = (await r.json()) as { connected?: boolean; replies?: FlowReply[] };
    return { connected: Boolean(j.connected), replies: Array.isArray(j.replies) ? j.replies : [] };
  },
};
const REPLY_POLL_MS = 5 * 60_000;
let lastReplyPoll = 0;

/** BI_SERVER_FLOW_REPLY_STOP_v1 - a reply to the flow's reply-to mailbox stops that person's flow. */
export async function stopRepliedMembers(db: Db, deps: FlowDeps, now: Date): Promise<{ stopped: number; mailboxes: Record<string, boolean> }> {
  const out = { stopped: 0, mailboxes: {} as Record<string, boolean> };
  if (!deps.replies) return out;
  // BI_SERVER_REPLIES_FROM_MAILBOX_v1 - out-of-office replies go back to the address the email came FROM, not the reply-to,
  // so the sending mailbox is read too (and it is the only one for a flow with no reply-to).
  const fromBox = String(biSendgridFrom() ?? "").trim().toLowerCase();
  const boxes = await db.query(
    `SELECT mailbox, min(since) AS since FROM (
       SELECT lower(btrim(coalesce(nullif(btrim(f.reply_to), ''), $1))) AS mailbox, m.first_sent_at AS since
         FROM bi_flows f JOIN bi_flow_members m ON m.flow_id = f.id
        WHERE f.status = 'active' AND m.status IN ('active', 'done') AND m.first_sent_at IS NOT NULL
       UNION ALL
       SELECT $1, m.first_sent_at FROM bi_flows f JOIN bi_flow_members m ON m.flow_id = f.id
        WHERE f.status = 'active' AND m.status IN ('active', 'done') AND m.first_sent_at IS NOT NULL AND $1 <> ''
     ) x WHERE coalesce(mailbox, '') <> '' GROUP BY 1`,
    [fromBox],
  );
  for (const b of boxes.rows) {
    const since = new Date(Math.max(new Date(b.since).getTime(), now.getTime() - 14 * 86_400_000));
    let res;
    try { res = await deps.replies(b.mailbox, since); }
    catch (err) { logger.warn({ mailbox: b.mailbox, err: (err as Error)?.message }, "flow.worker.replies_failed"); continue; }
    out.mailboxes[b.mailbox] = res.connected;
    for (const rep of res.replies) {
      if (rep.auto_reply) await addReferrals(db, rep);
      // An out-of-office reply is not an answer: the person is only away, so their emails carry on. A real reply, or an
      // automatic one saying they have left, stops them.
      if (rep.auto_reply && !rep.left) continue;
      const r = await db.query(
        `UPDATE bi_flow_members m SET status = 'stopped', stop_reason = 'replied', next_key = NULL, next_at = NULL, updated_at = now()
           FROM bi_flows f
          WHERE f.id = m.flow_id AND (lower(btrim(coalesce(nullif(btrim(f.reply_to), ''), $4))) = $1 OR $1 = $4)
            AND m.email = $2 AND m.status IN ('active', 'done')
            AND m.first_sent_at IS NOT NULL AND m.first_sent_at < $3::timestamptz AND coalesce(m.stop_reason, '') <> 'replied'
          RETURNING m.contact_id, f.name`,
        [b.mailbox, rep.from, rep.at, fromBox],
      );
      for (const row of r.rows) {
        out.stopped += 1;
        await db.query(
          `INSERT INTO bi_contact_activity (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
           VALUES (gen_random_uuid(), $1, NULL, 'Email flow', 'note', 'replied', $2, $3::jsonb)`,
          [row.contact_id, `Replied by email. The "${row.name}" emails have stopped for them.`, JSON.stringify({ at: rep.at })],
        ).catch((err: unknown) => logger.warn({ err: (err as Error)?.message }, "flow.worker.reply_activity_failed"));
      }
    }
  }
  return out;
}
/** BI_SERVER_AUTO_REPLY_REFERRALS_v1 - the colleagues an auto-reply names become contacts at the same company, with the
 *  same tags, so they join the same flow on the next hourly pass. A sender who has left gets a note and is taken off
 *  outreach (they will not read it); nobody is unsubscribed. */
export async function addReferrals(db: Db, rep: FlowReply): Promise<number> {
  const src = await db.query(
    `SELECT id, company_id, tags, country, full_name, COALESCE(outreach_excluded, false) AS excluded FROM bi_contacts WHERE lower(btrim(email)) = $1 ORDER BY created_at LIMIT 1`, [rep.from]);
  const orig = src.rows[0];
  if (!orig) return 0;
  let added = 0;
  for (const ref of (rep.referrals ?? []).slice(0, 5)) {
    const exists = await db.query(`SELECT 1 FROM bi_contacts WHERE lower(btrim(email)) = $1 OR lower(btrim(secondary_email)) = $1 LIMIT 1`, [ref.email]);
    if (exists.rowCount) continue;
    const name = ref.name || ref.email.split("@")[0]!.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    // BI_SERVER_REPLIES_FROM_MAILBOX_v1 - the colleague may already be a contact under another address (carrie@ vs crotman@):
    // then this address becomes their second one instead of a duplicate contact.
    if (ref.name && orig.company_id) {
      const same = await db.query(
        `UPDATE bi_contacts SET secondary_email = $3, updated_at = now()
          WHERE id = (SELECT id FROM bi_contacts WHERE company_id = $1 AND lower(btrim(full_name)) = lower(btrim($2)) ORDER BY created_at LIMIT 1)
            AND coalesce(btrim(secondary_email), '') = '' RETURNING id`,
        [orig.company_id, ref.name, ref.email],
      );
      if (same.rowCount) continue;
      const named = await db.query(`SELECT 1 FROM bi_contacts WHERE company_id = $1 AND lower(btrim(full_name)) = lower(btrim($2)) LIMIT 1`, [orig.company_id, ref.name]);
      if (named.rowCount) continue;
    }
    const parts = name.split(/\s+/);
    const tags = Array.from(new Set([...(orig.tags ?? []), "referred by auto-reply"]));
    const ins = await db.query(
      `INSERT INTO bi_contacts (full_name, first_name, last_name, email, phone_e164, company_id, tags, country, notes, source_first, outreach_status, outreach_updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6::text[], $7, $8, 'auto-reply referral', 'cold', now()) RETURNING id`,
      [name, parts[0] ?? null, parts.slice(1).join(" ") || null, ref.email, orig.company_id, tags, orig.country,
        `Named in ${orig.full_name ?? rep.from}'s automatic reply${ref.phone ? ` (phone given: ${ref.phone})` : ""}.`],
    );
    added += ins.rowCount ?? 0;
  }
  if (rep.left && orig.excluded && !added) return 0; // already noted on an earlier pass
  const note = rep.left
    ? `Automatic reply says they have left${added ? `; added ${added} colleague(s) it named` : ""}. Taken off outreach.`
    : added ? `Automatic reply named ${added} colleague(s); they were added as contacts.` : null;
  if (rep.left) await db.query(`UPDATE bi_contacts SET outreach_excluded = TRUE, outreach_updated_at = now() WHERE id = $1`, [orig.id]);
  if (note) {
    await db.query(
      `INSERT INTO bi_contact_activity (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, NULL, 'Email flow', 'note', 'auto_reply', $2, $3::jsonb)`,
      [orig.id, note, JSON.stringify({ at: rep.at, referrals: rep.referrals ?? [] })],
    ).catch((err: unknown) => logger.warn({ err: (err as Error)?.message }, "flow.worker.referral_note_failed"));
  }
  return added;
}
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
    `SELECT m.id, m.flow_id, m.contact_id, m.email, m.track, m.next_key, m.failures, m.round,
            f.name AS flow_name, f.emails, f.from_name, f.reply_to, f.link_url, f.booking_url,
            c.first_name, c.full_name, c.organization_name, c.email AS contact_email, c.secondary_email
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
    // BI_SERVER_FLOW_SECOND_ADDRESS_v1 - the second round goes to the address it was started on.
    const round = Number(row.round ?? 1);
    const to = String((round >= 2 ? row.email : row.contact_email) ?? "").trim();
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
      const files = Array.isArray(content.attachments) && content.attachments.length && deps.attachments ? await deps.attachments(content.attachments) : [];
      await deps.send({
        to, subject: mergeFields(String(content.subject), merge), html, text: htmlToText(html), fromName,
        ...(files.length ? { attachments: files } : {}),
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
    if (!next && endsFirstRoundUnopened(key as FlowKey, row.track as Track, round)) await startSecondRound(db, row, to, now);
  }
  return out;
}

/** BI_SERVER_FLOW_SECOND_ADDRESS_v1 - four weeks with no open on the first address: if the contact has a different second
 *  address (not already in this flow), the flow starts again at "e1" on it, a week after the last email. Once only;
 *  unsubscribes and bounces are still checked at each send. */
export async function startSecondRound(db: Db, row: { id: string; flow_id: string; contact_id: string; flow_name?: string; secondary_email?: string | null }, firstAddress: string, now: Date): Promise<boolean> {
  const second = String(row.secondary_email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(second) || second === firstAddress.trim().toLowerCase()) return false;
  const taken = await db.query(`SELECT 1 FROM bi_flow_members WHERE flow_id = $1 AND lower(email) = $2 AND id <> $3 LIMIT 1`, [row.flow_id, second, row.id]);
  if (taken.rowCount) return false;
  await db.query(
    `UPDATE bi_flow_members
        SET round = 2, email = $2, prior_keys = prior_keys || sent_keys, sent_keys = ARRAY[]::text[], track = 'none',
            next_key = 'e1', next_at = $3, status = 'active', updated_at = $4
      WHERE id = $1 AND round < 2`,
    [row.id, second, secondAddressStartAt(now), now],
  );
  await db.query(
    `INSERT INTO bi_contact_activity (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
     VALUES (gen_random_uuid(), $1, NULL, 'Email flow', 'note', 'second_address', $2, $3::jsonb)`,
    [row.contact_id, `No opens on ${firstAddress} after four weeks. The "${row.flow_name ?? "email"}" flow starts again at ${second}.`, JSON.stringify({ flow_id: row.flow_id })],
  ).catch((err: unknown) => logger.warn({ err: (err as Error)?.message, memberId: row.id }, "flow.worker.activity_failed"));
  return true;
}

export async function runFlowTick(db: Db, deps: FlowDeps, now = new Date(), pollReplies = true): Promise<Record<string, number>> {
  if (pgiMarketingHeld()) return { held: 1 }; // BI_SERVER_PGI_MARKETING_HOLD_v1
  const replied = pollReplies ? (await stopRepliedMembers(db, deps, now)).stopped : 0;
  const events = await ingestEvents(db);
  const tasks = await createCallTasks(db, deps);
  // BI_SERVER_FLOWS_AUTO_ADD_v1 - new people who match a running flow join it by themselves, once an hour.
  const joined = pollReplies && now.getTime() - lastAudienceAdd >= AUDIENCE_ADD_MS ? await addRunningAudiences(db) : 0;
  if (pollReplies && now.getTime() - lastAudienceAdd >= AUDIENCE_ADD_MS) lastAudienceAdd = now.getTime();
  const started = await startNewPeople(db, now);
  const sends = await sendDue(db, deps, now);
  return { replied, ...events, tasks, joined, started, ...sends };
}

const AUDIENCE_ADD_MS = 60 * 60_000;
let lastAudienceAdd = 0;
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
      const poll = Date.now() - lastReplyPoll >= REPLY_POLL_MS;
      if (poll) lastReplyPoll = Date.now();
      const result = await runFlowTick(client, liveDeps, new Date(), poll);
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
