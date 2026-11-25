import sgMail from "@sendgrid/mail";

export interface SendgridMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  /** One-to-one service mail (a contract to sign, a PIN): no unsubscribe footer or list headers. */
  transactional?: boolean;
  /** Carried back on every event for this email (open, click, bounce), so it can be tied to what sent it. */
  customArgs?: Record<string, string>;
  /** BI_SERVER_FLOW_ATTACHMENTS_v1 - files sent with the email (base64). */
  attachments?: Array<{ content: string; filename: string; type: string; disposition: "attachment" }>;
}

export interface SendgridResult { status: "accepted"; statusCode: number }

function apiKey(): string | undefined {
  return process.env.BI_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY;
}

export function biSendgridFrom(): string | undefined {
  return process.env.BI_SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM;
}

export function sendgridConfigured(): boolean {
  return Boolean(apiKey() && biSendgridFrom());
}

export function mergeFields(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_token, key: string) =>
    String(values[key.toLowerCase()] ?? ""));
}

// BI_SERVER_BRM_UNSUBSCRIBE_GROUP_v1 - Boreal Risk Management marketing mail used SendGrid's account-wide unsubscribe, so one
// click on it blocked the address for every brand on the shared account (Keystone and Boreal Financial too), breaking
// Todd's rule that unsubscribing from one brand does not stop the others. Marketing mail now carries Boreal Risk
// Management's own unsubscribe group: BI_SENDGRID_UNSUBSCRIBE_GROUP_ID, else the group named below (made if missing).
export const BRM_GROUP_NAME = "Boreal Risk Management";
let groupCache: { id: number | null; at: number } | null = null;
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export async function brmUnsubscribeGroup(fetchImpl: FetchLike = fetch as unknown as FetchLike, now = Date.now()): Promise<number | null> {
  const fromEnv = Number(process.env.BI_SENDGRID_UNSUBSCRIBE_GROUP_ID);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  if (groupCache && (groupCache.id !== null || now - groupCache.at < 10 * 60_000)) return groupCache.id;
  const key = apiKey();
  if (!key) return null;
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  try {
    const list = await fetchImpl("https://api.sendgrid.com/v3/asm/groups", { headers });
    const groups = list.ok ? await list.json() : [];
    const found = (Array.isArray(groups) ? groups : []).find((g: any) => String(g?.name ?? "").trim().toLowerCase() === BRM_GROUP_NAME.toLowerCase());
    let id = Number(found?.id) || null;
    if (!id) {
      const made = await fetchImpl("https://api.sendgrid.com/v3/asm/groups", {
        method: "POST", headers,
        body: JSON.stringify({ name: BRM_GROUP_NAME, description: "Personal guarantee insurance emails from Boreal Risk Management" }),
      });
      id = made.ok ? Number((await made.json())?.id) || null : null;
    }
    groupCache = { id, at: now };
    if (!id) console.warn("[bi-sendgrid] no Boreal Risk Management unsubscribe group; marketing mail keeps SendGrid's default unsubscribe");
    return id;
  } catch (err) {
    console.warn("[bi-sendgrid] unsubscribe group lookup failed", (err as Error)?.message);
    groupCache = { id: null, at: now };
    return null;
  }
}
export const BRM_UNSUBSCRIBE_LINK = "<%asm_group_unsubscribe_raw_url%>";
/** The group's own unsubscribe link at the foot of the email, when the email does not already carry one. */
export function withGroupUnsubscribe(html: string, text?: string): { html: string; text?: string } {
  if (html.includes("asm_group_unsubscribe")) return { html, text };
  const line = `<p style="font-size:12px;color:#6b7280;margin-top:12px"><a href="${BRM_UNSUBSCRIBE_LINK}" style="color:#6b7280">Unsubscribe from Boreal Risk Management emails</a></p>`;
  return { html: html + line, text: text ? `${text}\n\nUnsubscribe from Boreal Risk Management emails: ${BRM_UNSUBSCRIBE_LINK}` : text };
}
/** test hook */
export function resetBrmGroupCache(): void { groupCache = null; }

export async function sendBiMarketingEmail(message: SendgridMessage): Promise<SendgridResult> {
  const configuredApiKey = apiKey();
  const defaultFrom = biSendgridFrom();
  if (!configuredApiKey || !defaultFrom) throw new Error("BI SendGrid is not configured");
  sgMail.setApiKey(configuredApiKey);
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("SendGrid request timed out after 30s")), 30_000);
    timer.unref();
  });
  const group = message.transactional ? null : await brmUnsubscribeGroup();
  const body = group ? withGroupUnsubscribe(message.html, message.text) : { html: message.html, text: message.text };
  const request = sgMail.send({
    to: message.to,
    from: { email: message.fromEmail || defaultFrom, name: message.fromName || "Boreal Risk Management" },
    replyTo: message.replyTo,
    subject: message.subject,
    html: body.html,
    text: body.text,
    // BI_SENDGRID_EVENTS_v1 - bi_mkt marks every BI email, so BF-Server (where the shared SendGrid account's event
    // webhook points) passes its opens, clicks and bounces on to BI-Server.
    customArgs: { ...(message.customArgs ?? {}), bi_mkt: "1" },
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.transactional ? { trackingSettings: { subscriptionTracking: { enable: false } } } : {}),
    // BI_SERVER_BRM_UNSUBSCRIBE_GROUP_v1 - the group's link replaces SendGrid's account-wide one.
    ...(group ? { asm: { groupId: group }, trackingSettings: { subscriptionTracking: { enable: false } } } : {}),
  });
  const [response] = await Promise.race([request, timeout]);
  if (response.statusCode !== 202) throw new Error(`SendGrid returned ${response.statusCode}`);
  return { status: "accepted", statusCode: response.statusCode };
}
