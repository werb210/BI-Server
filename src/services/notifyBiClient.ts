// BI_SERVER_BLOCK_v588_APP_FIRST
// One way to tell a BI applicant something: the Boreal Risk app first, SMS only as the
// fallback. If the applicant has the app (a push token registered for their phone) and
// push is configured, the notice goes to the app and no text is sent. Otherwise - no app,
// push not configured yet, every device refused it - it goes by SMS. Never both. Never throws.
import type { BiPushKind } from "./push/biPushSender";

export type BiClientNotice = {
  applicationId: string;
  kind: BiPushKind;
  title: string;
  body: string;
  sms: string;
  smsTo: string | null;
  dedupeKey?: string;
};
export type BiNoticeResult = { channel: "push" | "sms" | "none"; sid?: string | null; error?: string };

export type BiNotifyDeps = {
  push: (n: BiClientNotice) => Promise<number>;
  sms: (to: string, text: string) => Promise<{ sid?: string | null }>;
};

export async function notifyBiClient(n: BiClientNotice, deps: BiNotifyDeps = defaultDeps): Promise<BiNoticeResult> {
  try {
    const pushed = await deps.push(n).catch(() => 0);
    if (pushed > 0) return { channel: "push" };
    if (!n.smsTo) return { channel: "none", error: "no_phone" };
    const r = await deps.sms(n.smsTo, n.sms);
    return { channel: "sms", sid: r?.sid ?? null };
  } catch (err: any) {
    const error = String(err?.message ?? err);
    console.error(JSON.stringify({ event: "bi_notify_client_failed", kind: n.kind, applicationId: n.applicationId, error }));
    return { channel: "none", error };
  }
}

const defaultDeps: BiNotifyDeps = {
  async push(n) {
    const { notifyBiApplicant } = await import("./push/biPushSender");
    const r = await notifyBiApplicant({ applicationId: n.applicationId, kind: n.kind, title: n.title, body: n.body, dedupeKey: n.dedupeKey });
    return r.sent;
  },
  async sms(to, text) {
    const { sendOutreachSms } = await import("./smsService");
    return sendOutreachSms(to, text);
  },
};
