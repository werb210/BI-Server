// BI_SERVER_v789_CARRIER_EVENTS - failure events for the carrier path.
// carrier_submission_failed: a submission to the carrier (PGI) failed.
// pgi_webhook_failed: a PGI webhook could not be processed (rolled back, 5xx
// returned so PGI retries).
// Both go to bi_events (silo 'bi'). Writing the event must never throw: a
// failure is logged and swallowed, because the caller is already on an error
// path and must still answer.
import { pool } from "../db";
import { logger } from "../platform/logger";
import { truncateForLog } from "../util/mask";

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

function errorSummary(err: unknown): { error_name: string; error_message: string; error_code: string | null } {
  const e = err as { name?: unknown; message?: unknown; code?: unknown } | null;
  return {
    error_name: typeof e?.name === "string" ? e.name : "Error",
    error_message: truncateForLog(typeof e?.message === "string" ? e.message : String(err), 500),
    error_code: typeof e?.code === "string" ? e.code : null,
  };
}

export async function recordCarrierSubmissionFailed(
  applicationId: string | null,
  err: unknown,
  context: Record<string, unknown> = {},
  db: Queryable = pool,
): Promise<void> {
  const payload = { ...context, ...errorSummary(err) };
  try {
    await db.query(
      `INSERT INTO bi_events(application_id, type, payload, silo) VALUES ($1, 'carrier_submission_failed', $2::jsonb, 'bi')`,
      [applicationId, JSON.stringify(payload)],
    );
  } catch (insertErr) {
    logger.warn({ err: insertErr, applicationId }, "bi_event_insert_failed:carrier_submission_failed");
  }
}

export async function recordPgiWebhookFailed(
  applicationId: string | null,
  err: unknown,
  context: Record<string, unknown> = {},
  db: Queryable = pool,
): Promise<void> {
  const payload = { ...context, ...errorSummary(err) };
  try {
    await db.query(
      `INSERT INTO bi_events(application_id, type, payload, silo) VALUES ($1, 'pgi_webhook_failed', $2::jsonb, 'bi')`,
      [applicationId, JSON.stringify(payload)],
    );
  } catch (insertErr) {
    logger.warn({ err: insertErr, applicationId }, "bi_event_insert_failed:pgi_webhook_failed");
  }
}
