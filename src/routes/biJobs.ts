// BI_SERVER_BLOCK_v242_PIPELINE_AND_REMINDERS_v1
// Cron-triggered endpoint that sends Mon-Fri SMS reminders to applicants
// who submitted without uploading documents. Pinged daily by GitHub
// Actions (.github/workflows/bi-docs-reminder.yml) at 13:00 UTC = 07:00
// MT. Authenticated via JOB_AUTH_TOKEN bearer; if the env var is unset
// the endpoint returns 503 so an accidental cron mis-fire can't run
// without explicit configuration.
//
// Reminder cadence:
//   - First scan finds apps with status='created' / pipeline_stage in
//     ('new_application','submitted_no_docs') and zero rows in bi_documents.
//   - Initializes docs_due_at = NOW() and sends the first SMS.
//   - Subsequent scans require docs_reminder_last_sent_at < NOW() - 24h.
//   - After 10 sends (~2 work weeks) we send an escalation SMS to
//     BI_ESCALATION_PHONE (the BI staff on-call number) and flip
//     docs_reminder_escalated=TRUE so we stop badgering the applicant.
//
// The cron job is idempotent: if it fires twice in the same day (e.g.
// GitHub Actions retries on flake), the docs_reminder_last_sent_at
// gate prevents duplicate sends to the same applicant.

import { Router } from "express";
import { pool } from "../db";
import { sendOutreachSms } from "../services/smsService";
import { logger } from "../platform/logger";
import { env } from "../platform/env";

const router = Router();

const MAX_REMINDERS = 10;

// v332: extracted handler body into runDocsReminderCronTick so the
// internal cron can call it directly (no HTTP, no auth round-trip).
// The HTTP endpoint stays as a thin wrapper for manual testing.
export async function runDocsReminderCronTick(): Promise<{ scanned: number; sent: number; escalated: number; failed: number; lockHeld: boolean }> {
  // Advisory lock so we don't double-fire when multiple BI-Server
  // instances are running. Same pattern v230 uses.
  const ADVISORY_LOCK_KEY = 8273420242;
  const lockResult = await pool.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [ADVISORY_LOCK_KEY],
  );
  if (lockResult.rows[0]?.locked !== true) {
    return { scanned: 0, sent: 0, escalated: 0, failed: 0, lockHeld: false };
  }
  try {
    return await runDocsReminderCronTickInner();
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
  }
}

async function runDocsReminderCronTickInner(): Promise<{ scanned: number; sent: number; escalated: number; failed: number; lockHeld: boolean }> {

  // Find apps in the "submitted, no docs" window. Note: a created_at
  // grace period of 5 minutes prevents us from reminding someone in the
  // middle of an upload session. The LEFT JOIN COUNT == 0 catches both
  // (a) never-uploaded apps and (b) apps where all docs were rejected
  // and purged. We deliberately exclude apps with any docs even if
  // they're status=rejected, on the assumption that the
  // rejection-triggered SMS (see biDocumentRoutes.ts line 291) is its
  // own communication channel.
  // BI_SERVER_BLOCK_v361_CRON_COLUMN_FIX_v1
  // (1) Replace `pipeline_stage` (non-existent column) with `a.stage`
  //     (the actual enum column from master schema).
  // (2) Broaden status filter: apps that SUBMIT but never upload docs
  //     have status='in_progress' (not 'created'). They should also
  //     get reminders. Same for 'document_review' (some docs uploaded,
  //     others missing).
  // BI_SERVER_BLOCK_v382_SUBMIT_SMS_AND_REMINDER_SIMPLIFY_v1
  // Phone selection falls back to guarantor_phone when
  // applicant_phone_e164 is NULL. The WHERE clause now gates on
  // COALESCE so any row with at least one phone qualifies.
  // The SELECT exposes both columns plus a sms_to convenience
  // expression to keep the call-site readable.
  const candidates = await pool.query(
    `SELECT a.id, a.public_id, a.business_name,
            a.docs_due_at, a.docs_reminder_last_sent_at, a.docs_reminder_count,
            COALESCE(a.applicant_phone_e164, a.guarantor_phone) AS sms_to
       FROM bi_applications a
       LEFT JOIN bi_documents d ON d.application_id = a.id AND d.purged_at IS NULL
      WHERE a.source = 'public'
        AND a.status IN ('created', 'in_progress', 'document_review')
        AND COALESCE(a.applicant_phone_e164, a.guarantor_phone) IS NOT NULL
        AND a.docs_reminder_escalated = FALSE
        AND a.docs_reminder_count < $1
        AND a.created_at < NOW() - INTERVAL '5 minutes'
        AND (
          a.docs_reminder_last_sent_at IS NULL
          OR a.docs_reminder_last_sent_at < NOW() - INTERVAL '23 hours'
        )
      GROUP BY a.id
     HAVING COUNT(d.id) = 0
      LIMIT 500`,
    [MAX_REMINDERS]
  );

  let sent = 0;
  let escalated = 0;
  let failed = 0;
  // BI_SERVER_BLOCK_v372_ESCALATION_PHONE_ENV_v1
  const escalationPhone = env.BI_ESCALATION_PHONE;

  for (const row of candidates.rows) {
    // BI_SERVER_BLOCK_v382_SUBMIT_SMS_AND_REMINDER_SIMPLIFY_v1
    // sms_to is COALESCE(applicant_phone_e164, guarantor_phone) computed
    // in the SELECT above. WHERE clause guarantees it's non-null here.
    const phone = row.sms_to;
    const publicId = row.public_id;
    const nextCount = (row.docs_reminder_count ?? 0) + 1;
    const isLast = nextCount >= MAX_REMINDERS;
    const businessName = row.business_name || "your application";

    try {
      const docUrl = `https://www.boreal.insure/applications/${publicId}/documents`;
      const body = isLast
        ? `Final reminder: your Boreal Risk application for ${businessName} is waiting on documents. Upload now or we will close it: ${docUrl}`
        : `Reminder: upload your financial documents to keep your Boreal Risk application moving for ${businessName}. ${docUrl}`;
      await sendOutreachSms(phone, body);
      sent += 1;

      if (isLast && escalationPhone) {
        try {
          await sendOutreachSms(
            escalationPhone,
            `BI escalation: applicant for ${businessName} (${publicId}) did not upload documents after ${MAX_REMINDERS} reminders. Phone: ${phone}`
          );
          escalated += 1;
        } catch (e: unknown) {
          logger.error({ err: e, phone: escalationPhone }, "bi_escalation_sms_failed");
        }
      }

      await pool.query(
        `UPDATE bi_applications
            SET docs_due_at = COALESCE(docs_due_at, NOW()),
                docs_reminder_last_sent_at = NOW(),
                docs_reminder_count = $1,
                docs_reminder_escalated = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [nextCount, isLast, row.id]
      );
    } catch (e: unknown) {
      failed += 1;
      logger.error({ err: e, phone, publicId }, "bi_docs_reminder_send_failed");
    }
  }

  return { scanned: candidates.rows.length, sent, escalated, failed, lockHeld: true };
}

// HTTP wrapper for manual testing. Internal cron in
// src/jobs/docsReminderCronJob.ts calls runDocsReminderCronTick() directly.
router.post("/jobs/docs-reminder", async (req, res) => {
  const required = process.env.JOB_AUTH_TOKEN;
  if (!required) {
    return res.status(503).json({ error: "job_auth_not_configured", message: "Set JOB_AUTH_TOKEN env var to enable cron jobs." });
  }
  const auth = String(req.headers.authorization ?? "");
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (presented !== required) {
    return res.status(401).json({ error: "invalid_job_auth" });
  }
  try {
    const result = await runDocsReminderCronTick();
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "docs_reminder_cron_http_failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
