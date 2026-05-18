import { pool } from "../db";
import { sendViaGraph } from "../integrations/microsoftGraph";

function render(template: string, contact: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => String(contact[key] ?? ""));
}

export async function runSequenceSendWorkerTick() {
  await pool.query(`UPDATE bi_user_send_quotas SET sent_today = 0, quota_date = CURRENT_DATE, updated_at = NOW() WHERE quota_date < CURRENT_DATE`);
  const due = await pool.query<any>(`SELECT * FROM bi_sequence_enrollments WHERE status='active' AND next_send_at <= NOW() ORDER BY next_send_at ASC LIMIT 100`);

  for (const enr of due.rows) {
    const stepNum = enr.current_step + 1;
    const stepR = await pool.query<any>(`SELECT * FROM bi_sequence_steps WHERE sequence_id = $1 AND step_number = $2 LIMIT 1`, [enr.sequence_id, stepNum]);
    const step = stepR.rows[0];
    if (!step) {
      await pool.query(`UPDATE bi_sequence_enrollments SET status='completed', completed_at=NOW(), next_send_at=NULL WHERE id = $1`, [enr.id]);
      continue;
    }
    const fromUserId = step.send_as_user_id || enr.enrolled_by_user_id;
    const q = await pool.query<any>(`INSERT INTO bi_user_send_quotas (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW() RETURNING *`, [fromUserId]);
    const quota = q.rows[0];
    if (quota.sent_today >= quota.daily_limit) {
      await pool.query(`UPDATE bi_sequence_enrollments SET next_send_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [enr.id]);
      continue;
    }
    const c = await pool.query<any>(`SELECT * FROM bi_contacts WHERE id = $1 LIMIT 1`, [enr.contact_id]);
    const contact = c.rows[0];
    const toEmail = contact?.email;
    if (!toEmail) continue;

    try {
      const sent = await sendViaGraph(fromUserId, toEmail, render(step.subject, contact), render(step.body_template, contact));
      await pool.query(`INSERT INTO bi_sequence_sends (enrollment_id, step_number, m365_message_id, m365_thread_id, from_user_id, to_email, subject, status, attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',1)`, [enr.id, stepNum, sent.m365_message_id, sent.m365_thread_id, fromUserId, toEmail, step.subject]);
      await pool.query(`UPDATE bi_user_send_quotas SET sent_today = sent_today + 1, updated_at = NOW() WHERE user_id = $1`, [fromUserId]);
      await pool.query(`INSERT INTO bi_contact_activity (contact_id, actor_user_id, kind, payload) VALUES ($1,$2,'email_sent',$3::jsonb)`, [enr.contact_id, fromUserId, JSON.stringify({ sequence_id: enr.sequence_id, enrollment_id: enr.id, step_number: stepNum })]);
      const next = await pool.query<any>(`SELECT * FROM bi_sequence_steps WHERE sequence_id=$1 AND step_number=$2 LIMIT 1`, [enr.sequence_id, stepNum + 1]);
      if (!next.rows[0]) await pool.query(`UPDATE bi_sequence_enrollments SET current_step=$2,status='completed',completed_at=NOW(),next_send_at=NULL WHERE id=$1`, [enr.id, stepNum]);
      else await pool.query(`UPDATE bi_sequence_enrollments SET current_step=$2,next_send_at=NOW() + ($3::int * INTERVAL '1 day') WHERE id=$1`, [enr.id, stepNum, next.rows[0].delay_days]);
    } catch (err: any) {
      const attemptsR = await pool.query<any>(`SELECT COALESCE(MAX(attempts),0) AS attempts FROM bi_sequence_sends WHERE enrollment_id = $1 AND step_number = $2`, [enr.id, stepNum]);
      const attempts = Number(attemptsR.rows[0]?.attempts || 0) + 1;
      await pool.query(`INSERT INTO bi_sequence_sends (enrollment_id, step_number, from_user_id, to_email, subject, status, error_message, attempts) VALUES ($1,$2,$3,$4,$5,'failed',$6,$7)`, [enr.id, stepNum, fromUserId, toEmail, step.subject, err?.message ?? 'send_failed', attempts]);
      if (attempts >= 3) await pool.query(`UPDATE bi_sequence_enrollments SET status='stopped' WHERE id=$1`, [enr.id]);
    }
  }
}

export function startSequenceSendWorker() {
  setInterval(() => {
    void runSequenceSendWorkerTick();
  }, 60_000);
}
