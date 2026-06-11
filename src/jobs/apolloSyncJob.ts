// BI_APOLLO_RUN_v55_PHASE3
/**
 * BI_APOLLO_SYNC_v54_PHASE2 — Apollo.io polling jobs.
 *
 * Two scheduled tasks:
 *   contactSync       — every 30 min — sync sequence-active contacts
 *   engagementSync    — every 15 min — sync email engagement events
 *
 * Both are no-ops unless APOLLO_SYNC_ENABLED=true and APOLLO_API_KEY is set.
 * runApolloSyncOnce() runs both inline (used by the manual admin trigger).
 */
import cron from "node-cron";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { searchContacts, listEmailerMessages, listSequences, listEmailAccounts, ApolloError, type ApolloEmailerMessage } from "../integrations/apollo/apolloClient";
import { upsertApolloContact } from "../integrations/apollo/apolloContactSync";

const CONTACT_PAGE_SIZE = 100;
const ENGAGEMENT_PAGE_SIZE = 100;
// Hard cap on pages processed per run, prevents runaway loops if Apollo
// returns inconsistent pagination metadata.
const MAX_PAGES_PER_RUN = 50;

function syncEnabled(): boolean {
  return process.env.APOLLO_SYNC_ENABLED === "true" && !!process.env.APOLLO_API_KEY;
}

async function getWatermark(field: "last_contact_sync_at" | "last_engagement_sync_at"): Promise<Date | null> {
  const r = await pool.query<{ ts: Date | null }>(
    `SELECT ${field} AS ts FROM bi_apollo_sync_state WHERE id = 1`
  );
  return r.rows[0]?.ts ?? null;
}

async function setWatermark(field: "last_contact_sync_at" | "last_engagement_sync_at", ts: Date, status: string, message: string | null = null) {
  await pool.query(
    `UPDATE bi_apollo_sync_state
       SET ${field} = $1, last_run_status = $2, last_run_message = $3, updated_at = NOW()
     WHERE id = 1`,
    [ts, status, message]
  );
}

/* ── Contact sync ──────────────────────────────────────────────────── */

// BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1
// Accept optional opts so the manual admin trigger can pull contacts
// regardless of sequence enrollment. Operator complaint: lists created
// in Apollo aren't syncing because contacts in those lists may not have
// been enrolled into any active sequence yet.
export async function runContactSyncOnce(opts: { includeNotInSequence?: boolean; sinceOverride?: string | null } = {}): Promise<{ pages: number; upserted: number }> {
  if (!syncEnabled()) {
    logger.info("apollo contact sync skipped — APOLLO_SYNC_ENABLED=false or APOLLO_API_KEY missing");
    return { pages: 0, upserted: 0 };
  }

  let updated_at_min: string;
  if (opts.sinceOverride !== undefined) {
    updated_at_min = opts.sinceOverride ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const since = await getWatermark("last_contact_sync_at");
    updated_at_min = since ? since.toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  const runStartedAt = new Date();

  let page = 1;
  let upserted = 0;
  let totalPages = 1;

  try {
    while (page <= totalPages && page <= MAX_PAGES_PER_RUN) {
      const { contacts, pagination } = await searchContacts({
        page, per_page: CONTACT_PAGE_SIZE,
        currently_in_sequence: opts.includeNotInSequence ? undefined : true,
        updated_at_min,
      });
      totalPages = pagination.total_pages || 1;

      for (const person of contacts) {
        try {
          await upsertApolloContact(person);
          upserted += 1;
        } catch (err) {
          logger.error({ err, apollo_id: person.id }, "apollo contact upsert failed");
        }
      }
      page += 1;
    }
    await setWatermark("last_contact_sync_at", runStartedAt, "ok", `pages=${page - 1} upserted=${upserted}`);
    logger.info({ pages: page - 1, upserted }, "apollo contact sync completed");
    return { pages: page - 1, upserted };
  } catch (err) {
    const message = err instanceof ApolloError ? `apollo ${err.status}` : err instanceof Error ? err.message : "unknown";
    await setWatermark("last_contact_sync_at", runStartedAt, "error", message);
    logger.error({ err }, "apollo contact sync failed");
    throw err;
  }
}

type EngagementEventRow = {
  apollo_contact_id: string | null;
  event_type: "email_sent" | "email_opened" | "email_clicked" | "email_replied" | "email_bounced";
  apollo_message_id: string;
  sequence_name: string | null;
  occurred_at: Date;
  metadata: Record<string, unknown>;
};

function deriveEvents(msg: ApolloEmailerMessage): EngagementEventRow[] {
  const out: EngagementEventRow[] = [];
  const seqName = msg.emailer_campaign?.name ?? null;
  const apolloContactId = msg.contact_id ?? null;
  const base = { apollo_contact_id: apolloContactId, apollo_message_id: msg.id, sequence_name: seqName };

  if (msg.delivered_at) out.push({ ...base, event_type: "email_sent", occurred_at: new Date(msg.delivered_at), metadata: { subject: msg.subject } });
  if (msg.opened_at) out.push({ ...base, event_type: "email_opened", occurred_at: new Date(msg.opened_at), metadata: { subject: msg.subject } });
  if (msg.clicked_at) out.push({ ...base, event_type: "email_clicked", occurred_at: new Date(msg.clicked_at), metadata: { subject: msg.subject } });
  if (msg.replied_at) out.push({ ...base, event_type: "email_replied", occurred_at: new Date(msg.replied_at), metadata: { subject: msg.subject } });
  if (msg.bounced_at) out.push({ ...base, event_type: "email_bounced", occurred_at: new Date(msg.bounced_at), metadata: { subject: msg.subject } });
  return out;
}

async function insertEngagementEvent(ev: EngagementEventRow): Promise<boolean> {
  const contactRow = ev.apollo_contact_id
    ? (await pool.query<{ id: string }>(
      `SELECT id FROM bi_contacts WHERE apollo_contact_id = $1 LIMIT 1`,
      [ev.apollo_contact_id]
    )).rows[0] ?? null
    : null;

  const ins = await pool.query(
    `INSERT INTO bi_crm_engagement_events
       (contact_id, apollo_contact_id, event_type, source, apollo_message_id, sequence_name, occurred_at, metadata)
     VALUES ($1, $2, $3, 'apollo', $4, $5, $6, $7::jsonb)
     ON CONFLICT (apollo_message_id, event_type)
     WHERE apollo_message_id IS NOT NULL
     DO NOTHING`,
    [contactRow?.id ?? null, ev.apollo_contact_id, ev.event_type, ev.apollo_message_id, ev.sequence_name, ev.occurred_at, JSON.stringify(ev.metadata)]
  );
  const wasNew = (ins.rowCount ?? 0) > 0;

  // BF_SERVER_BLOCK_v810_REPLY_ENGAGED — a genuinely new reply auto-advances the contact to
  // the canonical "engaged" board stage. Writes the OPERATIVE outreach_status column (NOT the
  // legacy outreach_stage), and is gated to pre-engaged states only so later stages and
  // not_interested are never regressed. Values per the board's LEGACY_MAP (cold/new ->
  // contacted -> engaged ...). Idempotent: only fires on the first insert of a given reply.
  if (wasNew && ev.event_type === "email_replied" && contactRow) {
    try {
      const adv = await pool.query(
        `UPDATE bi_contacts
            SET outreach_status = 'engaged', outreach_updated_at = NOW()
          WHERE id = $1
            AND (outreach_status IS NULL
                 OR outreach_status IN ('cold','new','attempting','voicemail','contacted'))`,
        [contactRow.id]
      );
      if ((adv.rowCount ?? 0) > 0) {
        await pool.query(
          `INSERT INTO bi_contact_activity
             (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
           VALUES (gen_random_uuid(), $1, NULL, 'Apollo (auto)', 'status_change', 'engaged', $2, $3::jsonb)`,
          [contactRow.id, "Auto-advanced to Engaged on email reply",
           JSON.stringify({ source: "apollo_reply", apollo_message_id: ev.apollo_message_id })]
        ).catch(() => undefined);
      }
    } catch (err) {
      logger.error({ err, contact_id: contactRow.id }, "reply auto-advance failed");
    }
  }
  return wasNew;
}

export async function runEngagementSyncOnce(): Promise<{ pages: number; events_inserted: number }> {
  if (!syncEnabled()) {
    logger.info("apollo engagement sync skipped — APOLLO_SYNC_ENABLED=false or APOLLO_API_KEY missing");
    return { pages: 0, events_inserted: 0 };
  }

  const since = await getWatermark("last_engagement_sync_at");
  const date_range_min = since ? since.toISOString() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const runStartedAt = new Date();

  let page = 1;
  let inserted = 0;
  let totalPages = 1;

  try {
    while (page <= totalPages && page <= MAX_PAGES_PER_RUN) {
      const { messages, pagination } = await listEmailerMessages({
        page, per_page: ENGAGEMENT_PAGE_SIZE, date_range_min,
      });
      totalPages = pagination.total_pages || 1;

      for (const msg of messages) {
        const events = deriveEvents(msg);
        for (const ev of events) {
          try {
            if (await insertEngagementEvent(ev)) inserted += 1;
          } catch (err) {
            logger.error({ err, apollo_message_id: ev.apollo_message_id }, "engagement insert failed");
          }
        }
      }
      page += 1;
    }
    await setWatermark("last_engagement_sync_at", runStartedAt, "ok", `pages=${page - 1} inserted=${inserted}`);
    logger.info({ pages: page - 1, inserted }, "apollo engagement sync completed");
    return { pages: page - 1, events_inserted: inserted };
  } catch (err) {
    const message = err instanceof ApolloError ? `apollo ${err.status}` : err instanceof Error ? err.message : "unknown";
    await setWatermark("last_engagement_sync_at", since ?? runStartedAt, "error", message);
    logger.error({ err }, "apollo engagement sync failed");
    throw err;
  }
}

// BI_SERVER_BLOCK_v840_APOLLO_CAMPAIGN_AND_MAILBOX_SYNC
// Pull Apollo campaigns (sequences) into bi_apollo_sequences so the Marketing
// portal's Sequences view shows them. The /emailer_messages endpoint is empty
// for this account until sends occur, so engagement still flows via webhook;
// campaigns + mailbox health come from these list endpoints.
export async function runSequenceSyncOnce(): Promise<{ upserted: number }> {
  if (!syncEnabled()) return { upserted: 0 };
  let upserted = 0;
  try {
    const { sequences } = await listSequences({ page: 1, per_page: 100 });
    for (const c of (sequences as any[])) {
      if (!c?.id) continue;
      await pool.query(
        `INSERT INTO bi_apollo_sequences (apollo_sequence_id, name, status, last_synced_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (apollo_sequence_id) DO UPDATE
           SET name = EXCLUDED.name, status = EXCLUDED.status, last_synced_at = NOW()`,
        [String(c.id), String(c.name ?? "Untitled"), c.active === false || c.archived ? "paused" : "active"],
      );
      upserted += 1;
    }
    await pool.query(`UPDATE bi_apollo_sync_state SET last_sequence_sync_at = NOW(), updated_at = NOW() WHERE id = 1`).catch(() => {});
    logger.info({ upserted }, "apollo sequence sync completed");
  } catch (err) {
    logger.error({ err }, "apollo sequence sync failed");
  }
  return { upserted };
}

// Pull mailbox deliverability from Apollo email_accounts into bi_mailbox_health
// (today's window). Idempotent: replaces today's row per mailbox/channel.
export async function runMailboxHealthSyncOnce(): Promise<{ mailboxes: number }> {
  if (!syncEnabled()) return { mailboxes: 0 };
  let count = 0;
  try {
    const { email_accounts } = await listEmailAccounts();
    for (const a of (email_accounts as any[])) {
      const mailbox = String(a?.email ?? "").trim();
      if (!mailbox) continue;
      const ds = a?.deliverability_score ?? {};
      const sent = Math.round(Number(ds.avg_daily_sent ?? 0));
      // Apollo gives rates, not counts; store sent and derive counts from rates so
      // the portal's rate math (delivered/sent etc.) round-trips sensibly.
      const delivered = Math.round(sent * Number(ds.avg_delivered_rate ?? 0));
      const opened = Math.round(delivered * Number(ds.avg_open_rate ?? 0));
      const clicked = Math.round(delivered * Number(ds.avg_click_rate ?? 0));
      const replied = Math.round(delivered * Number(ds.avg_reply_rate ?? 0));
      const bounced = Math.round(sent * Number(ds.avg_hard_bounce_rate ?? 0));
      const spam = Math.round(sent * Number(ds.avg_spam_block_rate ?? 0));
      await pool.query(
        `DELETE FROM bi_mailbox_health WHERE mailbox = $1 AND channel = 'email' AND window_start = CURRENT_DATE`,
        [mailbox],
      );
      await pool.query(
        `INSERT INTO bi_mailbox_health (mailbox, channel, window_start, sent, delivered, opened, clicked, replied, bounced, spam_complained)
         VALUES ($1, 'email', CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)`,
        [mailbox, sent, delivered, opened, clicked, replied, bounced, spam],
      );
      count += 1;
    }
    await pool.query(`UPDATE bi_apollo_sync_state SET last_email_account_sync_at = NOW(), updated_at = NOW() WHERE id = 1`).catch(() => {});
    logger.info({ mailboxes: count }, "apollo mailbox health sync completed");
  } catch (err) {
    logger.error({ err }, "apollo mailbox health sync failed");
  }
  return { mailboxes: count };
}

export async function runApolloSyncOnce(): Promise<{ contacts: { pages: number; upserted: number }; engagement: { pages: number; events_inserted: number } }> {
  const contacts = await runContactSyncOnce();
  const engagement = await runEngagementSyncOnce();
  await runSequenceSyncOnce();        // BI_SERVER_BLOCK_v840_APOLLO_CAMPAIGN_AND_MAILBOX_SYNC
  await runMailboxHealthSyncOnce();   // BI_SERVER_BLOCK_v840_APOLLO_CAMPAIGN_AND_MAILBOX_SYNC
  return { contacts, engagement };
}

let started = false;
export function startApolloSyncJob(): void {
  if (started) return;
  if (!syncEnabled()) {
    logger.info("apollo cron not started — APOLLO_SYNC_ENABLED=false");
    return;
  }
  // v328: includeNotInSequence=true so we pull ALL recently-updated Apollo
  // contacts, not just ones already enrolled in a sequence. Without this,
  // a fresh Boreal deploy syncs zero contacts until someone manually
  // enrolls them somewhere.
  cron.schedule("*/30 * * * *", async () => {
    try { await runContactSyncOnce({ includeNotInSequence: true }); } catch (err) { logger.error({ err }, "contact sync cron tick failed"); }
  });
  cron.schedule("*/15 * * * *", async () => {
    try { await runEngagementSyncOnce(); } catch (err) { logger.error({ err }, "engagement sync cron tick failed"); }
  });
  cron.schedule("*/30 * * * *", async () => {  // BI_SERVER_BLOCK_v840
    try { await runSequenceSyncOnce(); await runMailboxHealthSyncOnce(); }
    catch (err) { logger.error({ err }, "sequence/mailbox sync cron tick failed"); }
  });
  // v328: initial sync ~10s after boot with a 1-year window so the
  // first deploy doesn't make the operator wait 30 min for any data.
  // Watermark takes over after this run; subsequent ticks are incremental.
  setTimeout(async () => {
    try {
      logger.info("apollo initial sync starting (1-year window)");
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const contacts = await runContactSyncOnce({ includeNotInSequence: true, sinceOverride: oneYearAgo });
      const engagement = await runEngagementSyncOnce();
      await runSequenceSyncOnce();       // BI_SERVER_BLOCK_v840
      await runMailboxHealthSyncOnce();  // BI_SERVER_BLOCK_v840
      logger.info({ contacts, engagement }, "apollo initial sync completed");
    } catch (err) {
      logger.error({ err }, "apollo initial sync failed");
    }
  }, 10_000);
  started = true;
  logger.info("apollo cron jobs scheduled (contacts: */30, engagement: */15, initial: +10s)");
}
