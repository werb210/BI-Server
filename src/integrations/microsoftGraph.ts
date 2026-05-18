import { pool } from "../db";

export class MissingConsentError extends Error {
  constructor(public readonly userId: string) {
    super("Missing Mail.Send consent");
    this.name = "MissingConsentError";
  }
}

async function graphFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
}

async function loadAccessToken(userId: string): Promise<string | null> {
  const r = await pool.query<{ m365_access_token: string | null }>(
    `SELECT m365_access_token FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.m365_access_token ?? null;
}

export async function sendViaGraph(fromUserId: string, toEmail: string, subject: string, bodyHtml: string) {
  const token = await loadAccessToken(fromUserId);
  if (!token) throw new MissingConsentError(fromUserId);

  const createRes = await graphFetch(token, `/users/${encodeURIComponent(fromUserId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      subject,
      body: { contentType: "HTML", content: bodyHtml },
      toRecipients: [{ emailAddress: { address: toEmail } }],
    }),
  });
  if (!createRes.ok) throw new Error(`Graph createMessage failed (${createRes.status})`);
  const created = (await createRes.json()) as { id: string };

  const sendRes = await graphFetch(token, `/users/${encodeURIComponent(fromUserId)}/messages/${encodeURIComponent(created.id)}/send`, { method: "POST" });
  if (!sendRes.ok) throw new Error(`Graph send failed (${sendRes.status})`);

  const getRes = await graphFetch(token, `/users/${encodeURIComponent(fromUserId)}/messages/${encodeURIComponent(created.id)}?$select=id,conversationId`);
  if (!getRes.ok) throw new Error(`Graph message lookup failed (${getRes.status})`);
  const msg = (await getRes.json()) as { id: string; conversationId: string };

  return { m365_message_id: msg.id, m365_thread_id: msg.conversationId };
}
