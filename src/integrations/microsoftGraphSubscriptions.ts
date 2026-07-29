import { pool } from "../db";

// BI_SEQ_REPLY_DETECTION_v1
export async function handleGraphReplyWebhook(notifications: any[]) {
  for (const notification of notifications) {
    const userId = notification.resourceData?.userId;
    const messageId = notification.resourceData?.id;
    if (!userId || !messageId) continue;

    const userResult = await pool.query<any>(
      `SELECT m365_webhook_secret, m365_access_token FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user || user.m365_webhook_secret !== notification.clientState) continue;

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}?$select=from,bodyPreview`,
      { headers: { Authorization: `Bearer ${user.m365_access_token}` } },
    );
    if (!response.ok) continue;
    const message = await response.json() as any;
    const senderAddress = String(message.from?.emailAddress?.address ?? "").trim().toLowerCase();
    if (!senderAddress) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const enrollments = await client.query<{ id: string; contact_id: string }>(
        `UPDATE bi_sequence_enrollments e
            SET status = 'replied', next_step_at = NULL
           FROM bi_contacts c
          WHERE e.contact_id = c.id
            AND e.status = 'active'
            AND lower(c.email) = $1
          RETURNING e.id, e.contact_id`,
        [senderAddress],
      );

      for (const enrollment of enrollments.rows) {
        await client.query(
          `INSERT INTO bi_sequence_events
             (enrollment_id, step_id, event_type, channel, sender_id, metadata)
           VALUES ($1, NULL, 'replied', 'email', NULL, $2::jsonb)`,
          [enrollment.id, JSON.stringify({ sender: senderAddress, snippet: message.bodyPreview ?? "" })],
        );
      }

      if (enrollments.rows.length > 0) {
        const contactIds = [...new Set(enrollments.rows.map((row) => row.contact_id))];
        await client.query(
          `UPDATE bi_contacts SET outreach_stage = 'engaged' WHERE id = ANY($1::uuid[])`,
          [contactIds],
        );
        await client.query(
          `INSERT INTO bi_contact_activity (contact_id, kind, payload)
           SELECT unnest($1::uuid[]), 'email_replied', $2::jsonb`,
          [contactIds, JSON.stringify({ sender: senderAddress, snippet: message.bodyPreview ?? "" })],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
