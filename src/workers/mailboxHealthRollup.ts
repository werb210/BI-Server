import { pool } from "../db";
import { logger } from "../platform/logger";

async function rollupYesterday(): Promise<void> {
  await pool.query(
    `INSERT INTO bi_mailbox_health (
       mailbox, channel, window_start,
       sent, delivered, opened, clicked, replied, bounced, spam_complained
     )
     SELECT
       COALESCE(sender_id, 'unknown')                       AS mailbox,
       channel,
       (NOW() - INTERVAL '1 day')::date                     AS window_start,
       COUNT(*) FILTER (WHERE event_type = 'sent')::int      AS sent,
       COUNT(*) FILTER (WHERE event_type = 'delivered')::int AS delivered,
       COUNT(*) FILTER (WHERE event_type = 'opened')::int    AS opened,
       COUNT(*) FILTER (WHERE event_type = 'clicked')::int   AS clicked,
       COUNT(*) FILTER (WHERE event_type = 'replied')::int   AS replied,
       COUNT(*) FILTER (WHERE event_type = 'bounced')::int   AS bounced,
       0                                                     AS spam_complained
     FROM bi_sequence_events
     WHERE channel IS NOT NULL
       AND created_at >= (NOW() - INTERVAL '1 day')::date
       AND created_at <  NOW()::date
     GROUP BY 1, 2
     ON CONFLICT (mailbox, channel, window_start) DO UPDATE
       SET sent      = EXCLUDED.sent,
           delivered = EXCLUDED.delivered,
           opened    = EXCLUDED.opened,
           clicked   = EXCLUDED.clicked,
           replied   = EXCLUDED.replied,
           bounced   = EXCLUDED.bounced,
           updated_at = NOW()`,
  );
}

let timer: NodeJS.Timeout | null = null;
export function startMailboxHealthRollup(): void {
  if (timer) return;
  void rollupYesterday().catch((err) => logger.error({ err }, "mailbox.rollup.failed"));
  timer = setInterval(() => {
    void rollupYesterday().catch((err) => logger.error({ err }, "mailbox.rollup.failed"));
  }, 60 * 60 * 1000);
}
