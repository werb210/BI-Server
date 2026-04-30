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
import { searchContacts, listEmailerMessages, ApolloError, type ApolloEmailerMessage } from "../integrations/apollo/apolloClient";
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

export async function runContactSyncOnce(): Promise<{ pages: number; upserted: number }> {
  if (!syncEnabled()) {
    logger.info("apollo contact sync skipped — APOLLO_SYNC_ENABLED=false or APOLLO_API_KEY missing");
    return { pages: 0, upserted: 0 };
  }

  const since = await getWatermark("last_contact_sync_at");
  const updated_at_min = since ? since.toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const runStartedAt = new Date();

  let page = 1;
  let upserted = 0;
  let totalPages = 1;

  try {
    while (page <= totalPages && page <= MAX_PAGES_PER_RUN) {
      const { contacts, pagination } = await searchContacts({
        page, per_page: CONTACT_PAGE_SIZE,
        currently_in_sequence: true,
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
    await setWatermark("last_contact_sync_at", since ?? runStartedAt, "error", message);
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
  return (ins.rowCount ?? 0) > 0;
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

export async function runApolloSyncOnce(): Promise<{ contacts: { pages: number; upserted: number }; engagement: { pages: number; events_inserted: number } }> {
  const contacts = await runContactSyncOnce();
  const engagement = await runEngagementSyncOnce();
  return { contacts, engagement };
}

let started = false;
export function startApolloSyncJob(): void {
  if (started) return;
  if (!syncEnabled()) {
    logger.info("apollo cron not started — APOLLO_SYNC_ENABLED=false");
    return;
  }
  cron.schedule("*/30 * * * *", async () => {
    try { await runContactSyncOnce(); } catch (err) { logger.error({ err }, "contact sync cron tick failed"); }
  });
  cron.schedule("*/15 * * * *", async () => {
    try { await runEngagementSyncOnce(); } catch (err) { logger.error({ err }, "engagement sync cron tick failed"); }
  });
  started = true;
  logger.info("apollo cron jobs scheduled (contacts: */30, engagement: */15)");
}
