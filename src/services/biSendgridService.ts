import sgMail from "@sendgrid/mail";

export interface SendgridMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendgridResult { status: "accepted"; statusCode: number }

export function sendgridConfigured(): boolean {
  return Boolean(process.env.BI_SENDGRID_API_KEY && process.env.BI_SENDGRID_FROM_EMAIL);
}

export function mergeFields(template: string, values: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_token, key: string) =>
    String(values[key.toLowerCase()] ?? ""));
}

export async function sendBiMarketingEmail(message: SendgridMessage): Promise<SendgridResult> {
  const apiKey = process.env.BI_SENDGRID_API_KEY;
  const defaultFrom = process.env.BI_SENDGRID_FROM_EMAIL;
  if (!apiKey || !defaultFrom) throw new Error("BI SendGrid is not configured");
  sgMail.setApiKey(apiKey);
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
  });
  const [response] = await Promise.race([request, timeout]);
  if (response.statusCode !== 202) throw new Error(`SendGrid returned ${response.statusCode}`);
  return { status: "accepted", statusCode: response.statusCode };
}
