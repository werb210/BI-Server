// BI_SERVER_ABANDONED_NUDGE_v1 - PGI applications get started (OTP -> created)
// and never submitted. Nudge the applicant by SMS: first nudge 1 hour after
// start, second 24 hours after the first, then stop. Only applications still
// in status 'created' (submit advances to 'in_progress') and younger than 7
// days are nudged. Sent-flags live in bi_applications.data JSONB
// (abandon_nudge_sent_at / abandon_nudge2_sent_at) - no migration needed.
// The flag is stamped BEFORE sending so a mid-send crash can never double-text
// a customer (a lost nudge is acceptable; duplicate SMS is not).
import { pool } from "../db";
import { logger } from "../platform/logger";
import { sendOutreachSms } from "../services/smsService";

const TICK_MS = 15 * 60 * 1000;
const BATCH = 25;

function nudgeBody(publicId: string): string {
  const url = `https://boreal.insure/applications/${publicId}/form`;
  return (
    "Thank you for starting your PGI application. We noticed you did not complete it. " +
    `Please return to ${url} to finalize the application. If you have questions and would ` +
    "like one of our intake team members to reach out, just respond to this text."
  );
}

type Row = { id: string; public_id: string; applicant_phone_e164: string };

async function sendBatch(rows: Row[], flagKey: string): Promise<number> {
  let sent = 0;
  for (const row of rows) {
    try {
      // Stamp first (see header comment), then send.
      await pool.query(
        `UPDATE bi_applications
            SET data = jsonb_set(COALESCE(data, '{}'::jsonb), $2, to_jsonb(NOW()::text), true)
          WHERE id = $1`,
        [row.id, `{${flagKey}}`],
      );
      await sendOutreachSms(row.applicant_phone_e164, nudgeBody(row.public_id));
      sent += 1;
    } catch (err) {
      logger.error(
        { applicationId: row.id, flagKey, err: err instanceof Error ? err.message : String(err) },
        "abandoned_nudge_send_failed",
      );
    }
  }
  return sent;
}

export async function runAbandonedNudgeTick(): Promise<{ first: number; second: number }> {
  const first = await pool.query<Row>(
    `SELECT id, public_id, applicant_phone_e164
       FROM bi_applications
      WHERE COALESCE(NULLIF(lower(status), ''), 'created') = 'created'
        AND public_id IS NOT NULL
        AND COALESCE(applicant_phone_e164, '') <> ''
        AND created_at <= NOW() - INTERVAL '1 hour'
        AND created_at >= NOW() - INTERVAL '7 days'
        AND (data ->> 'abandon_nudge_sent_at') IS NULL
      ORDER BY created_at ASC
      LIMIT $1`,
    [BATCH],
  );
  const firstSent = await sendBatch(first.rows, "abandon_nudge_sent_at");

  const second = await pool.query<Row>(
    `SELECT id, public_id, applicant_phone_e164
       FROM bi_applications
      WHERE COALESCE(NULLIF(lower(status), ''), 'created') = 'created'
        AND public_id IS NOT NULL
        AND COALESCE(applicant_phone_e164, '') <> ''
        AND created_at >= NOW() - INTERVAL '7 days'
        AND (data ->> 'abandon_nudge_sent_at') IS NOT NULL
        AND (data ->> 'abandon_nudge_sent_at')::timestamp <= NOW() - INTERVAL '24 hours'
        AND (data ->> 'abandon_nudge2_sent_at') IS NULL
      ORDER BY created_at ASC
      LIMIT $1`,
    [BATCH],
  );
  const secondSent = await sendBatch(second.rows, "abandon_nudge2_sent_at");

  if (firstSent || secondSent) {
    logger.info({ first: firstSent, second: secondSent }, "abandoned_nudge_tick");
  }
  return { first: firstSent, second: secondSent };
}

export function startAbandonedApplicationNudge(): void {
  setInterval(() => {
    void runAbandonedNudgeTick().catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "abandoned_nudge_tick_failed");
    });
  }, TICK_MS);
  logger.info({ tickMs: TICK_MS }, "abandonedApplicationNudge worker started");
}
