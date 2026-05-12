// BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
import twilio from "twilio";
import { pool } from "../db";
import { logger } from "../platform/logger";

const REQUIRED_DOC_TYPES = ["profit_loss","balance_sheet","ar_aging","ap_aging","founder_cv"];
export const REMINDER_BODY =
  "Boreal Risk: You started an application but your documents are not in yet. " +
  "Sign in at https://boreal.financial/applications/new to upload them. " +
  "Reply STOP to opt out.";

function isBusinessHoursMT(now: Date): boolean {
  const mt = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const day = mt.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = mt.getUTCHours();
  return hour >= 10 && hour < 17;
}

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}

export async function runDocReminderTick(now: Date = new Date()): Promise<{ checked: number; sent: number; skipped: number }> {
  if (!isBusinessHoursMT(now)) return { checked: 0, sent: 0, skipped: 0 };
  const candidates = await pool.query<{id:string;public_id:string;applicant_phone_e164:string|null;guarantor_phone:string|null;doc_reminder_count:number;docs_uploaded:number;}>(
    `SELECT a.id, a.public_id, a.applicant_phone_e164, a.guarantor_phone, a.doc_reminder_count,
            (SELECT COUNT(DISTINCT doc_type) FROM bi_documents d
              WHERE d.application_id = a.id AND d.doc_type = ANY($1)) AS docs_uploaded
       FROM bi_applications a
      WHERE a.status IN ('in_progress', 'document_review')
        AND a.created_at >= NOW() - INTERVAL '14 days'
        AND (a.last_doc_reminder_at IS NULL OR a.last_doc_reminder_at < NOW() - INTERVAL '20 hours')
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [REQUIRED_DOC_TYPES],
  );
  const client = getTwilio();
  const from = process.env.TWILIO_FROM;
  let sent = 0, skipped = 0;
  for (const row of candidates.rows) {
    const docsComplete = Number(row.docs_uploaded) >= REQUIRED_DOC_TYPES.length;
    if (docsComplete) { skipped += 1; continue; }
    const to = row.applicant_phone_e164 || row.guarantor_phone;
    if (!to) { skipped += 1; continue; }
    if (!client || !from) { logger.warn({ public_id: row.public_id }, "[docReminder] Twilio not configured — skipping"); skipped += 1; continue; }
    try {
      await client.messages.create({ from, to, body: REMINDER_BODY });
      await pool.query(`UPDATE bi_applications SET last_doc_reminder_at = NOW(), doc_reminder_count = doc_reminder_count + 1 WHERE id = $1`, [row.id]);
      await pool.query(`INSERT INTO bi_activity(application_id, actor_type, event_type, summary) VALUES($1, 'system', 'doc_reminder_sent', $2)`, [row.id, `Doc reminder SMS #${row.doc_reminder_count + 1} sent to ${to}`]).catch(() => {});
      sent += 1;
    } catch (err) { logger.error({ err, public_id: row.public_id, to }, "[docReminder] send failed"); skipped += 1; }
  }
  if (sent > 0 || skipped > 0) logger.info({ checked: candidates.rows.length, sent, skipped }, "[docReminder] tick complete");
  return { checked: candidates.rows.length, sent, skipped };
}

export function startDocReminderJob(): void {
  const TICK_MS = 60 * 60 * 1000;
  const handle = setInterval(() => { runDocReminderTick().catch((err) => logger.error({ err }, "[docReminder] tick threw")); }, TICK_MS);
  if (typeof (handle as any).unref === "function") (handle as any).unref();
  setTimeout(() => { runDocReminderTick().catch((err) => logger.error({ err }, "[docReminder] initial tick threw")); }, 30_000).unref();
  logger.info({ TICK_MS }, "[docReminder] startDocReminderJob: scheduled");
}
