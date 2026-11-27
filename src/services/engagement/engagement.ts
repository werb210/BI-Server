// BI_SERVER_ENGAGEMENT_v1 (2026-11-27) - PGI marketing follow-through. Every contact the email flows reach gets one
// bi_engagement row that climbs the stages by itself:
//   sent -> opened -> clicked -> replied -> booked -> met -> signed_up      (or lost: unsubscribed / not interested)
// Sends, opens, clicks and replies come from the flows (bi_flow_members); bookings from BF-Server (Microsoft Bookings
// and meetings, matched by email); meetings held and "followed up" from staff; sign-ups from the lender and referrer
// tables. Anyone who replies, books or clicks gets a follow-up due date and an owner (the follow-up people in the
// settings, round robin; else the flow's owner), and a reply or booking also makes a task for that owner.
import { classifyReply, closesFollowUp, replyBody, type ReplyKind } from "./classifyReply";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

// BI_SERVER_PIPELINE_v1 - the stages Todd set out, in order. "Follow-up" = staff answered and they have not written back
// for FOLLOW_UP_DAYS. A booked call or Teams meeting moves them to Initial call by itself; Demo, Signed up and Not
// interested are set by staff (or sign-up by the lender/referrer tables).
export const STAGES = ["emailed", "opened", "clicked", "replied", "responded", "follow_up", "initial_call", "demo", "signed_up"] as const;
export type Stage = (typeof STAGES)[number] | "lost";
export const STAGE_LABEL: Record<Stage, string> = {
  emailed: "Emailed", opened: "Opened", clicked: "Clicked", replied: "Replied", responded: "Staff responded",
  follow_up: "Follow-up", initial_call: "Initial call", demo: "Demo", signed_up: "Signed up", lost: "Not interested",
};
export const STAGE_HELP: Record<Stage, string> = {
  emailed: "Getting the first emails. Nothing back yet.",
  opened: "Opened an email.",
  clicked: "Clicked a link in an email.",
  replied: "Wrote back. Nobody has answered yet.",
  responded: "We answered. Waiting for them.",
  follow_up: "We answered 3+ days ago and they have not written back.",
  initial_call: "A call or Teams meeting is booked or held.",
  demo: "Demo booked or done.",
  signed_up: "Signed up as a lender or referrer.",
  lost: "Not interested, or unsubscribed.",
};
export const FOLLOW_UP_DAYS = 3;
const DUE_HOURS: Record<string, number> = { replied: 24, booked: 24, clicked: 48 };

const ANSWERED = `e.responded_at IS NOT NULL AND e.replied_at IS NOT NULL AND e.responded_at >= COALESCE(e.last_reply_at, e.replied_at)`;
export const STAGE_SQL = `CASE WHEN e.lost_at IS NOT NULL THEN 'lost' WHEN e.signed_up_at IS NOT NULL THEN 'signed_up'
  WHEN e.demo_at IS NOT NULL THEN 'demo' WHEN e.booked_at IS NOT NULL OR e.met_at IS NOT NULL THEN 'initial_call'
  WHEN ${ANSWERED} AND e.responded_at < now() - interval '${FOLLOW_UP_DAYS} days' THEN 'follow_up'
  WHEN ${ANSWERED} THEN 'responded' WHEN e.replied_at IS NOT NULL THEN 'replied'
  WHEN e.clicked_at IS NOT NULL THEN 'clicked' WHEN e.opened_at IS NOT NULL THEN 'opened' ELSE 'emailed' END`;
const STAGE_AT_SQL = `CASE WHEN e.lost_at IS NOT NULL THEN e.lost_at WHEN e.signed_up_at IS NOT NULL THEN e.signed_up_at
  WHEN e.demo_at IS NOT NULL THEN e.demo_at WHEN e.booked_at IS NOT NULL OR e.met_at IS NOT NULL THEN COALESCE(e.booked_at, e.met_at)
  WHEN ${ANSWERED} THEN e.responded_at WHEN e.replied_at IS NOT NULL THEN COALESCE(e.last_reply_at, e.replied_at)
  WHEN e.clicked_at IS NOT NULL THEN e.clicked_at WHEN e.opened_at IS NOT NULL THEN e.opened_at ELSE e.sent_at END`;

export type Follower = { id: string; name: string };
export async function getSettings(db: Db): Promise<{ followers: Follower[]; digest: boolean }> {
  const r = await db.query(`SELECT value FROM bi_engagement_settings WHERE key = 'follow_up'`);
  const v = r.rows[0]?.value ?? {};
  const followers = Array.isArray(v.followers)
    ? v.followers.filter((f: any) => f && f.id).map((f: any) => ({ id: String(f.id), name: String(f.name ?? f.id) }))
    : [];
  return { followers, digest: v.digest !== false };
}
export async function saveSettings(db: Db, s: { followers?: Follower[]; digest?: boolean }): Promise<void> {
  const cur = await getSettings(db);
  const next = { followers: s.followers ?? cur.followers, digest: s.digest ?? cur.digest };
  await db.query(
    `INSERT INTO bi_engagement_settings (key, value, updated_at) VALUES ('follow_up', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
}

/** Brings every row up to date. Safe to run as often as you like. */
export async function syncEngagement(db: Db): Promise<Record<string, number>> {
  // 1. Sends, opens, clicks and replies from the flows (earliest of each across a contact's flows; the newest flow).
  const flows = await db.query(
    `INSERT INTO bi_engagement AS e (contact_id, flow_id, sent_at, opened_at, clicked_at, replied_at)
     SELECT m.contact_id, (array_agg(m.flow_id ORDER BY m.first_sent_at DESC))[1], min(m.first_sent_at), min(m.opened_at),
            min(m.clicked_at), min(CASE WHEN m.stop_reason = 'replied' THEN m.updated_at END)
       FROM bi_flow_members m WHERE m.first_sent_at IS NOT NULL GROUP BY m.contact_id
     ON CONFLICT (contact_id) DO UPDATE SET
       flow_id = EXCLUDED.flow_id,
       sent_at = LEAST(e.sent_at, EXCLUDED.sent_at),
       opened_at = COALESCE(e.opened_at, EXCLUDED.opened_at),
       clicked_at = COALESCE(e.clicked_at, EXCLUDED.clicked_at),
       replied_at = COALESCE(e.replied_at, EXCLUDED.replied_at),
       updated_at = now()
     WHERE e.flow_id IS DISTINCT FROM EXCLUDED.flow_id OR e.sent_at IS DISTINCT FROM LEAST(e.sent_at, EXCLUDED.sent_at)
        OR (e.opened_at IS NULL AND EXCLUDED.opened_at IS NOT NULL) OR (e.clicked_at IS NULL AND EXCLUDED.clicked_at IS NOT NULL)
        OR (e.replied_at IS NULL AND EXCLUDED.replied_at IS NOT NULL)`,
  );
  // BI_SERVER_PIPELINE_v1 - which email they replied to: the last one their flow had sent when the reply stopped it.
  await db.query(
    `UPDATE bi_engagement e SET replied_key = x.k, last_reply_at = GREATEST(e.last_reply_at, e.replied_at), updated_at = now()
       FROM (SELECT DISTINCT ON (contact_id) contact_id, sent_keys[array_length(sent_keys, 1)] AS k
               FROM bi_flow_members WHERE stop_reason = 'replied' AND array_length(sent_keys, 1) > 0 ORDER BY contact_id, updated_at) x
      WHERE e.contact_id = x.contact_id AND (e.replied_key IS DISTINCT FROM x.k OR (e.last_reply_at IS NULL AND e.replied_at IS NOT NULL))`,
  );
  // 2. Signed up: became a lender portal contact or a referrer after the first email.
  const signed = await db.query(
    `UPDATE bi_engagement e SET signed_up_at = s.at, updated_at = now()
       FROM (SELECT c.id AS contact_id, min(x.at) AS at
               FROM bi_contacts c
               JOIN (SELECT lower(btrim(email)) AS em, created_at::timestamptz AS at FROM bi_lender_contacts WHERE email IS NOT NULL
                     UNION ALL SELECT lower(btrim(email)), created_at FROM bi_lender_login_contacts WHERE email IS NOT NULL
                     UNION ALL SELECT lower(btrim(email)), created_at::timestamptz FROM bi_referrers WHERE email IS NOT NULL) x
                 ON x.em = lower(btrim(c.email))
              GROUP BY c.id) s
      WHERE e.contact_id = s.contact_id AND e.signed_up_at IS NULL AND e.sent_at IS NOT NULL AND s.at >= e.sent_at`,
  );
  // 3. Stage from the timestamps.
  const staged = await db.query(
    `UPDATE bi_engagement e SET stage = ${STAGE_SQL}, stage_at = ${STAGE_AT_SQL}, updated_at = now()
      WHERE e.stage IS DISTINCT FROM ${STAGE_SQL} OR e.stage_at IS DISTINCT FROM ${STAGE_AT_SQL}`,
  );
  // 4. Follow-ups: a reply, booking or click newer than the last follow-up opens one; closing stages clear it.
  const opened = await db.query(
    `UPDATE bi_engagement e SET follow_up_due_at = x.trig + make_interval(hours => CASE x.reason WHEN 'clicked' THEN ${DUE_HOURS.clicked} ELSE ${DUE_HOURS.replied} END),
            follow_up_reason = x.reason, updated_at = now()
       FROM (SELECT contact_id, GREATEST(replied_at, booked_at, clicked_at) AS trig,
                    CASE WHEN replied_at IS NOT NULL AND replied_at >= COALESCE(GREATEST(booked_at, clicked_at), replied_at) THEN 'replied'
                         WHEN booked_at IS NOT NULL AND booked_at >= COALESCE(clicked_at, booked_at) THEN 'booked' ELSE 'clicked' END AS reason
               FROM bi_engagement) x
      WHERE e.contact_id = x.contact_id AND x.trig IS NOT NULL AND e.lost_at IS NULL AND e.signed_up_at IS NULL AND e.met_at IS NULL
        AND e.follow_up_due_at IS NULL AND x.trig > COALESCE(e.followed_up_at, 'epoch'::timestamptz)`,
  );
  const cleared = await db.query(
    `UPDATE bi_engagement SET follow_up_due_at = NULL, updated_at = now()
      WHERE follow_up_due_at IS NOT NULL AND (lost_at IS NOT NULL OR signed_up_at IS NOT NULL)`,
  );
  const owners = await assignOwners(db);
  return { flows: flows.rowCount ?? 0, signed: signed.rowCount ?? 0, staged: staged.rowCount ?? 0, opened: opened.rowCount ?? 0, cleared: cleared.rowCount ?? 0, owners };
}

/** Who follows up: the follow-up people in turn (whoever has the fewest open), else the flow's owner. */
export async function assignOwners(db: Db): Promise<number> {
  const need = await db.query(
    `SELECT e.contact_id, f.owner_user_id, f.owner_name FROM bi_engagement e LEFT JOIN bi_flows f ON f.id = e.flow_id
      WHERE e.follow_up_due_at IS NOT NULL AND e.owner_user_id IS NULL ORDER BY e.follow_up_due_at LIMIT 500`,
  );
  if (!need.rows.length) return 0;
  const { followers } = await getSettings(db);
  const load = new Map<string, number>(followers.map((f) => [f.id, 0]));
  if (followers.length) {
    const r = await db.query(
      `SELECT owner_user_id, count(*)::int AS n FROM bi_engagement WHERE follow_up_due_at IS NOT NULL AND owner_user_id = ANY($1::text[]) GROUP BY 1`,
      [followers.map((f) => f.id)],
    );
    for (const row of r.rows) load.set(String(row.owner_user_id), Number(row.n));
  }
  let n = 0;
  for (const row of need.rows) {
    let owner: Follower | null = null;
    if (followers.length) {
      owner = followers.reduce((best, f) => ((load.get(f.id) ?? 0) < (load.get(best.id) ?? 0) ? f : best), followers[0]!);
      load.set(owner.id, (load.get(owner.id) ?? 0) + 1);
    } else if (row.owner_user_id) owner = { id: String(row.owner_user_id), name: String(row.owner_name ?? "") };
    if (!owner) continue;
    await db.query(`UPDATE bi_engagement SET owner_user_id = $2, owner_name = $3, updated_at = now() WHERE contact_id = $1`, [row.contact_id, owner.id, owner.name || null]);
    n += 1;
  }
  return n;
}

export async function contactIdsByEmail(db: Db, email: string): Promise<string[]> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return [];
  const r = await db.query(
    `SELECT id FROM bi_contacts WHERE lower(btrim(email)) = $1 OR lower(btrim(coalesce(secondary_email, ''))) = $1`, [e]);
  return r.rows.map((x) => String(x.id));
}

async function ensureRow(db: Db, contactId: string): Promise<void> {
  await db.query(`INSERT INTO bi_engagement (contact_id) VALUES ($1) ON CONFLICT (contact_id) DO NOTHING`, [contactId]);
}
async function logEvent(db: Db, contactId: string, kind: string, detail: Record<string, unknown>, actor: string | null, at: Date) {
  await db.query(`INSERT INTO bi_engagement_events (contact_id, kind, detail, actor_name, at) VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [contactId, kind, JSON.stringify(detail), actor, at]);
}

/** A reply someone sent: what kind it is, and a follow-up unless it closes the door. Only for contacts we marketed to. */
export async function recordReply(db: Db, input: { contactId: string; at: Date; subject?: string | null; body?: string | null; mailbox?: string | null }): Promise<ReplyKind | null> {
  // Only people the flows emailed: a stranger writing in is not a marketing reply.
  const ex = await db.query(
    `SELECT 1 FROM bi_engagement WHERE contact_id = $1 UNION ALL
     SELECT 1 FROM bi_flow_members WHERE contact_id = $1 AND first_sent_at IS NOT NULL LIMIT 1`, [input.contactId]);
  if (!ex.rowCount) return null;
  await ensureRow(db, input.contactId);
  const kind = classifyReply(input.subject, input.body);
  const snippet = replyBody(input.body, 600) || null;
  const closes = closesFollowUp(kind);
  await db.query(
    `UPDATE bi_engagement SET replied_at = COALESCE(replied_at, $2), last_reply_at = GREATEST(last_reply_at, $2), reply_kind = $3, reply_subject = $4, reply_snippet = $5,
            reply_mailbox = $6, lost_at = CASE WHEN $7 THEN COALESCE(lost_at, $2) ELSE lost_at END,
            lost_reason = CASE WHEN $7 THEN $3 ELSE lost_reason END,
            follow_up_due_at = CASE WHEN $7 THEN NULL WHEN $2 > COALESCE(followed_up_at, 'epoch'::timestamptz) THEN $2 + interval '${DUE_HOURS.replied} hours' ELSE follow_up_due_at END,
            follow_up_reason = CASE WHEN $7 THEN follow_up_reason ELSE 'replied' END, updated_at = now()
      WHERE contact_id = $1`,
    [input.contactId, input.at, kind, input.subject ? String(input.subject).slice(0, 300) : null, snippet, input.mailbox ?? null, closes],
  );
  await logEvent(db, input.contactId, "replied", { kind, subject: input.subject ?? null, mailbox: input.mailbox ?? null }, null, input.at);
  return kind;
}

export type EventKind = "booked" | "met" | "no_show" | "followed_up" | "lost" | "reopen" | "signed_up" | "reply_kind" | "requeue"
  | "responded" | "initial_call" | "demo" | "auto";
/** Bookings (BF-Server) and staff actions. */
export async function recordEvent(db: Db, input: { contactId: string; kind: EventKind; at?: Date; detail?: Record<string, any>; actor?: string | null }): Promise<boolean> {
  const at = input.at ?? new Date();
  const d = input.detail ?? {};
  if (input.kind === "booked") await ensureRow(db, input.contactId);
  const sets: Record<EventKind, string> = {
    booked: `booked_at = COALESCE(booked_at, $2), meeting_at = COALESCE($3::timestamptz, meeting_at), meeting_outcome = NULL`,
    met: `met_at = COALESCE(met_at, $2), meeting_outcome = 'held', follow_up_due_at = NULL, followed_up_at = $2`,
    no_show: `meeting_outcome = 'no_show', follow_up_due_at = $2, follow_up_reason = 'no_show'`,
    followed_up: `followed_up_at = $2, follow_up_due_at = NULL`,
    lost: `lost_at = COALESCE(lost_at, $2), lost_reason = COALESCE($3::text, 'staff'), follow_up_due_at = NULL`,
    reopen: `lost_at = NULL, lost_reason = NULL`,
    signed_up: `signed_up_at = COALESCE(signed_up_at, $2), lost_at = NULL, lost_reason = NULL, follow_up_due_at = NULL`,
    reply_kind: `reply_kind = $3::text`,
    // ENGAGEMENT_REQUEUE_v1 - undo a click on Followed up / Not interested: back in the follow-up list, due now.
    // BI_SERVER_PIPELINE_v1 - staff answered (BF-Server reads Sent Items); staff moving a card on the pipeline.
    responded: `responded_at = GREATEST(responded_at, $2), followed_up_at = GREATEST(followed_up_at, $2), follow_up_due_at = NULL`,
    initial_call: `booked_at = COALESCE(booked_at, $2), demo_at = NULL, signed_up_at = NULL, lost_at = NULL, lost_reason = NULL`,
    demo: `demo_at = COALESCE(demo_at, $2), signed_up_at = NULL, lost_at = NULL, lost_reason = NULL`,
    auto: `booked_at = NULL, met_at = NULL, meeting_outcome = NULL, demo_at = NULL, signed_up_at = NULL, lost_at = NULL, lost_reason = NULL`,
    requeue: `followed_up_at = NULL, lost_at = NULL, lost_reason = NULL, follow_up_due_at = COALESCE(follow_up_due_at, $2), follow_up_reason = COALESCE(follow_up_reason, stage)`,
  };
  const third = input.kind === "booked" ? (d.start ?? null) : input.kind === "lost" ? (d.reason ?? null) : input.kind === "reply_kind" ? (d.kind ?? null) : null;
  const sql = `UPDATE bi_engagement SET ${sets[input.kind]}, updated_at = now() WHERE contact_id = $1`;
  // Only send $3 when the statement uses it: Postgres refuses a parameter it cannot type.
  const all = [input.contactId, at, third];
  let used = all.length;
  while (used > 1 && !sql.includes(`$${used}`)) used -= 1;
  const sqlFinal = sql.includes("$3") && !sql.includes("$2") ? sql.replace(/\$3/g, "$2") : sql;
  const r = await db.query(sqlFinal, sql.includes("$3") && !sql.includes("$2") ? [input.contactId, third] : all.slice(0, used));
  if (!r.rowCount) return false;
  await logEvent(db, input.contactId, input.kind, d, input.actor ?? null, at);
  await db.query(`UPDATE bi_engagement e SET stage = ${STAGE_SQL}, stage_at = ${STAGE_AT_SQL} WHERE e.contact_id = $1`, [input.contactId]);
  return true;
}

/** A task for each new reply or booking (once per reply/booking), for the owner. */
export async function createFollowUpTasks(db: Db, task: (owner: string, title: string, notes: string) => Promise<{ ok: boolean }>): Promise<number> {
  const r = await db.query(
    `SELECT e.contact_id, e.owner_user_id, e.follow_up_reason, e.reply_kind, e.reply_snippet, e.meeting_at,
            GREATEST(e.replied_at, e.booked_at) AS trig, c.full_name, c.organization_name, c.email, c.phone_e164, f.name AS flow_name
       FROM bi_engagement e JOIN bi_contacts c ON c.id = e.contact_id LEFT JOIN bi_flows f ON f.id = e.flow_id
      WHERE e.follow_up_due_at IS NOT NULL AND e.owner_user_id IS NOT NULL AND e.follow_up_reason IN ('replied', 'booked')
        AND e.task_for IS DISTINCT FROM GREATEST(e.replied_at, e.booked_at) LIMIT 100`,
  );
  let n = 0;
  for (const row of r.rows) {
    const who = [row.full_name, row.organization_name].filter(Boolean).join(", ") || row.email || "a contact";
    const title = row.follow_up_reason === "booked" ? `Prepare for the call with ${who} (booked)` : `Reply to ${who} - answered the PGI email`;
    const notes = row.follow_up_reason === "booked"
      ? `${who} booked a time${row.meeting_at ? ` for ${new Date(row.meeting_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}. Open Insurance > Marketing > Outreach.`
      : `${row.reply_kind ? `Reply type: ${row.reply_kind}. ` : ""}${row.reply_snippet ? `They wrote: "${String(row.reply_snippet).slice(0, 300)}". ` : ""}${row.phone_e164 ? `Phone: ${row.phone_e164}. ` : ""}Open Insurance > Marketing > Outreach.`;
    const res = await task(String(row.owner_user_id), title, notes).catch(() => ({ ok: false }));
    if (!res.ok) continue;
    await db.query(`UPDATE bi_engagement SET task_for = $2 WHERE contact_id = $1`, [row.contact_id, row.trig]);
    n += 1;
  }
  return n;
}

const CARD_SQL = `e.contact_id, e.stage, e.stage_at, e.flow_id, f.name AS flow_name, e.reply_kind, e.reply_subject, e.reply_snippet,
  e.owner_user_id, e.owner_name, e.follow_up_due_at, e.follow_up_reason, e.meeting_at, e.meeting_outcome, e.sent_at, e.opened_at,
  e.clicked_at, e.replied_at, e.booked_at, e.met_at, e.signed_up_at, e.lost_at, c.full_name, c.organization_name, c.email, c.phone_e164,
  e.last_reply_at, e.responded_at, e.replied_key, e.demo_at, e.lost_reason, coalesce(mk.keys, '{}') AS sent_keys`;
// BI_SERVER_PIPELINE_v1 - every flow email the contact has been sent (e1..n4 = the four first emails, o1/o2 = after an open,
// c1 = after a click), across their flows.
const FROM_SQL = `FROM bi_engagement e JOIN bi_contacts c ON c.id = e.contact_id LEFT JOIN bi_flows f ON f.id = e.flow_id
  LEFT JOIN LATERAL (SELECT array_agg(DISTINCT k ORDER BY k) AS keys FROM bi_flow_members m, unnest(m.sent_keys) k WHERE m.contact_id = e.contact_id) mk ON true`;

type Filters = { flowId?: string | null; owner?: string | null; q?: string | null };
function where(f: Filters, params: unknown[]): string {
  const w: string[] = [];
  if (f.flowId) { params.push(f.flowId); w.push(`e.flow_id = $${params.length}`); }
  if (f.owner) { params.push(f.owner); w.push(`e.owner_user_id = $${params.length}`); }
  if (f.q) { params.push(`%${f.q}%`); w.push(`(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.organization_name ILIKE $${params.length})`); }
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}

/** The pipeline: every stage with its count and its newest cards (perStage, or one stage from an offset for "Show more"). */
export async function board(db: Db, f: Filters & { stage?: string | null; offset?: number }, perStage = 100) {
  const p: unknown[] = [];
  const w = where(f, p);
  const keys = [...STAGES, "lost" as const];
  const counts = await db.query(`SELECT e.stage, count(*)::int AS n FROM bi_engagement e JOIN bi_contacts c ON c.id = e.contact_id ${w} GROUP BY 1`, p);
  const n = new Map(counts.rows.map((r) => [r.stage, r.n]));
  const only = f.stage && (keys as string[]).includes(f.stage) ? f.stage : null;
  const p2 = [...p, perStage, Math.max(0, Math.trunc(f.offset ?? 0))];
  const cards = await db.query(
    `SELECT * FROM (SELECT ${CARD_SQL}, row_number() OVER (PARTITION BY e.stage ORDER BY e.stage_at DESC NULLS LAST, e.contact_id) AS rn ${FROM_SQL} ${w}) x
      WHERE rn > $${p2.length} AND rn <= $${p2.length} + $${p2.length - 1} ${only ? `AND stage = '${only}'` : ""} ORDER BY stage_at DESC NULLS LAST`, p2);
  return keys.filter((s) => !only || s === only).map((s) => ({ key: s, label: STAGE_LABEL[s], help: STAGE_HELP[s], count: n.get(s) ?? 0, cards: cards.rows.filter((c) => c.stage === s) }));
}

export async function queue(db: Db, f: Filters) {
  const p: unknown[] = [];
  const w = where(f, p);
  const r = await db.query(`SELECT ${CARD_SQL} ${FROM_SQL} ${w ? `${w} AND` : "WHERE"} e.follow_up_due_at IS NOT NULL ORDER BY e.follow_up_due_at LIMIT 500`, p);
  const now = Date.now();
  return r.rows.map((x) => ({ ...x, overdue: new Date(x.follow_up_due_at).getTime() < now }));
}

export async function funnel(db: Db, since?: Date | null) {
  const p: unknown[] = [];
  const w = since ? (p.push(since), `WHERE e.sent_at >= $1`) : "";
  // BI_SERVER_PIPELINE_v1 - "reached" counts: how many got to each stage or past it.
  const cols = `count(*)::int AS sent, count(e.opened_at)::int AS opened, count(e.clicked_at)::int AS clicked, count(e.replied_at)::int AS replied,
    count(*) FILTER (WHERE e.responded_at IS NOT NULL AND e.replied_at IS NOT NULL)::int AS responded,
    count(*) FILTER (WHERE e.booked_at IS NOT NULL OR e.met_at IS NOT NULL)::int AS initial_call, count(e.demo_at)::int AS demo,
    count(e.signed_up_at)::int AS signed_up, count(e.lost_at)::int AS lost`;
  const total = await db.query(`SELECT ${cols} FROM bi_engagement e ${w}`, p);
  const byFlow = await db.query(`SELECT e.flow_id, coalesce(f.name, 'No flow') AS name, ${cols} FROM bi_engagement e LEFT JOIN bi_flows f ON f.id = e.flow_id ${w} GROUP BY 1, 2 ORDER BY sent DESC`, p);
  const kinds = await db.query(`SELECT coalesce(e.reply_kind, 'other') AS kind, count(*)::int AS n FROM bi_engagement e ${w ? `${w} AND` : "WHERE"} e.replied_at IS NOT NULL GROUP BY 1`, p);
  const leaks = await db.query(
    `SELECT count(*) FILTER (WHERE e.stage = 'replied')::int AS unanswered,
            count(*) FILTER (WHERE e.stage = 'replied' AND COALESCE(e.last_reply_at, e.replied_at) < now() - interval '1 day')::int AS unanswered_day,
            count(*) FILTER (WHERE e.stage = 'follow_up')::int AS follow_up,
            round(avg(extract(epoch FROM (e.responded_at - e.replied_at)) / 3600) FILTER (WHERE e.responded_at > e.replied_at)::numeric, 1) AS avg_reply_hours
       FROM bi_engagement e ${w}`, p);
  return { total: total.rows[0], byFlow: byFlow.rows, replyKinds: kinds.rows, leaks: leaks.rows[0] };
}

export async function contactDetail(db: Db, contactId: string) {
  const r = await db.query(`SELECT ${CARD_SQL} ${FROM_SQL} WHERE e.contact_id = $1`, [contactId]);
  if (!r.rows[0]) return null;
  const ev = await db.query(`SELECT kind, detail, actor_name, at FROM bi_engagement_events WHERE contact_id = $1 ORDER BY at DESC LIMIT 100`, [contactId]);
  return { ...r.rows[0], events: ev.rows };
}

/** The morning numbers for one owner (BF-Server mails the digest). */
export async function digestFor(db: Db, ownerId: string) {
  const r = await db.query(
    `SELECT count(*) FILTER (WHERE follow_up_due_at IS NOT NULL)::int AS open,
            count(*) FILTER (WHERE follow_up_due_at < now())::int AS overdue,
            count(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_reason = 'replied')::int AS replies,
            count(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_reason = 'booked')::int AS bookings,
            count(*) FILTER (WHERE follow_up_due_at IS NOT NULL AND follow_up_reason = 'clicked')::int AS clickers,
            count(*) FILTER (WHERE meeting_at::date = (now() AT TIME ZONE 'America/Edmonton')::date)::int AS meetings_today
       FROM bi_engagement WHERE owner_user_id = $1`, [ownerId]);
  const top = await db.query(
    `SELECT c.full_name, c.organization_name, e.follow_up_reason, e.reply_kind, e.follow_up_due_at
       FROM bi_engagement e JOIN bi_contacts c ON c.id = e.contact_id
      WHERE e.owner_user_id = $1 AND e.follow_up_due_at IS NOT NULL ORDER BY e.follow_up_due_at LIMIT 10`, [ownerId]);
  return { ...r.rows[0], top: top.rows };
}
export async function owners(db: Db): Promise<Follower[]> {
  const r = await db.query(`SELECT owner_user_id AS id, max(owner_name) AS name FROM bi_engagement WHERE owner_user_id IS NOT NULL AND follow_up_due_at IS NOT NULL GROUP BY 1`);
  return r.rows.map((x) => ({ id: String(x.id), name: String(x.name ?? "") }));
}
