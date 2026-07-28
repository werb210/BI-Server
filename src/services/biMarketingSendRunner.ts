import type { Pool } from "pg";
import { buildAudienceSelectSql, audienceParams, contactMergeVars, type AudienceFilter } from "./biEmailAudience";
import { mergeFields, sendBiMarketingEmail } from "./biSendgridService";
import { logger } from "../platform/logger";

export async function drainBiSendQueue(pool: Pool): Promise<boolean> {
  const claim = await pool.query(`UPDATE bi_marketing_send_jobs SET status='running', started_at=NOW()
    WHERE id=(SELECT id FROM bi_marketing_send_jobs WHERE status='queued' AND scheduled_at<=NOW()
      ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
  const job = claim.rows[0];
  if (!job) return false;
  try {
    const filter = (job.filters || {}) as AudienceFilter;
    const contacts = await pool.query(buildAudienceSelectSql(), audienceParams(filter));
    for (const contact of contacts.rows) {
      const state = await pool.query("SELECT status FROM bi_marketing_send_jobs WHERE id=$1", [job.id]);
      if (state.rows[0]?.status === "cancelled") return true;
      const inserted = await pool.query(`INSERT INTO bi_marketing_send_recipients(job_id,contact_id,email)
        VALUES($1,$2,$3) ON CONFLICT(job_id,contact_id) DO NOTHING RETURNING id`, [job.id, contact.id, contact.email]);
      if (!inserted.rowCount) continue;
      try {
        const vars = contactMergeVars(contact);
        await sendBiMarketingEmail({ to: contact.email, subject: mergeFields(job.subject, vars),
          html: mergeFields(job.html, vars), text: job.text_body ? mergeFields(job.text_body, vars) : undefined });
        await pool.query("UPDATE bi_marketing_send_recipients SET status='accepted',accepted_at=NOW() WHERE id=$1", [inserted.rows[0].id]);
      } catch (err) {
        await pool.query("UPDATE bi_marketing_send_recipients SET status='failed',error=$2 WHERE id=$1", [inserted.rows[0].id, err instanceof Error ? err.message : String(err)]);
      }
    }
    await pool.query("UPDATE bi_marketing_send_jobs SET status='completed',completed_at=NOW() WHERE id=$1 AND status='running'", [job.id]);
  } catch (err) {
    await pool.query("UPDATE bi_marketing_send_jobs SET status='failed',completed_at=NOW(),error=$2 WHERE id=$1", [job.id, err instanceof Error ? err.message : String(err)]);
    logger.error({ err, jobId: job.id }, "bi marketing bulk send failed");
  }
  return true;
}

export function startBiSendWorker(pool: Pool): void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { while (await drainBiSendQueue(pool)) { /* drain */ } }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
}
