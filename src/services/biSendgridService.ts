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

export async function sendBiMarketingEmail(message: SendgridMessage): Promise<SendgridResult> {
  const configuredApiKey = apiKey();
  const defaultFrom = biSendgridFrom();
  if (!configuredApiKey || !defaultFrom) throw new Error("BI SendGrid is not configured");
  sgMail.setApiKey(configuredApiKey);
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("SendGrid request timed out after 30s")), 30_000);
    timer.unref();
  });
  const request = sgMail.send({
    to: message.to,
    from: { email: message.fromEmail || defaultFrom, name: message.fromName || "Boreal Risk Management" },
    replyTo: message.replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    // BI_SENDGRID_EVENTS_v1 - bi_mkt marks every BI email, so BF-Server (where the shared SendGrid account's event
    // webhook points) passes its opens, clicks and bounces on to BI-Server.
    customArgs: { ...(message.customArgs ?? {}), bi_mkt: "1" },
    ...(message.transactional ? { trackingSettings: { subscriptionTracking: { enable: false } } } : {}),
  });
  const [response] = await Promise.race([request, timeout]);
  if (response.statusCode !== 202) throw new Error(`SendGrid returned ${response.statusCode}`);
  return { status: "accepted", statusCode: response.statusCode };
}
