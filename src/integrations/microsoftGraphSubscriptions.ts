import { pool } from "../db";

export async function handleGraphReplyWebhook(notifications: any[]) {
  for (const n of notifications) {
    const userId = n.resourceData?.userId;
    const messageId = n.resourceData?.id;
    const clientState = n.clientState;
    if (!userId || !messageId) continue;
    const userR = await pool.query<any>(`SELECT m365_webhook_secret, m365_access_token FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const user = userR.rows[0];
    if (!user || user.m365_webhook_secret !== clientState) continue;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}?$select=conversationId,bodyPreview`, { headers: { Authorization: `Bearer ${user.m365_access_token}` } });
    if (!res.ok) continue;
    const msg = await res.json() as any;
    const sendR = await pool.query<any>(`SELECT id, enrollment_id FROM bi_sequence_sends WHERE m365_thread_id = $1 ORDER BY sent_at DESC LIMIT 1`, [msg.conversationId]);
    const send = sendR.rows[0];
    if (!send) continue;
    await pool.query(`UPDATE bi_sequence_sends SET status='replied' WHERE id = $1`, [send.id]);
    await pool.query(`UPDATE bi_sequence_enrollments SET status='replied', next_send_at=NULL WHERE id = $1`, [send.enrollment_id]);
    await pool.query(`UPDATE bi_contacts c SET outreach_stage='engaged' FROM bi_sequence_enrollments e WHERE e.id = $1 AND c.id = e.contact_id AND c.outreach_stage IN ('queued','contacted')`, [send.enrollment_id]);
    await pool.query(`INSERT INTO bi_contact_activity (contact_id, kind, payload) SELECT contact_id, 'email_replied', $2::jsonb FROM bi_sequence_enrollments WHERE id = $1`, [send.enrollment_id, JSON.stringify({ snippet: msg.bodyPreview ?? "" })]);
  }
}
