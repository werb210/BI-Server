import twilio from "twilio";
import { env } from "../platform/env";

const hasTwilio = Boolean(
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
);

const smsClient = hasTwilio
  ? twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!)
  : null;

type RejectArgs = { name: string; docType: string; reason: string; link: string };

const TEMPLATES = {
  document_rejected: (args: RejectArgs) =>
    `Hi ${args.name}, your ${args.docType} was not accepted. Reason: ${args.reason}. Please re-upload: ${args.link}`
};

export async function sendDocumentRejectedSms(to: string, args: RejectArgs) {
  const body = TEMPLATES.document_rejected(args);
  if (!smsClient) {
    console.log(`[sms mock] to=${to} body="${body}"`);
    return { sid: "mock", mock: true };
  }
  return smsClient.messages.create({ from: env.TWILIO_FROM!, to, body });
}

// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
// Generic SMS send used by outreach demo-invite flow. Returns
// { sid, mock } on success; throws on Twilio error so the caller
// can record the failure to the activity timeline.
export async function sendOutreachSms(to: string, body: string): Promise<{ sid: string; mock?: boolean }> {
  if (!smsClient) {
    console.log(`[sms mock] outreach to=${to} body="${body}"`);
    return { sid: "mock", mock: true };
  }
  const r = await smsClient.messages.create({ from: env.TWILIO_FROM!, to, body });
  return { sid: r.sid };
}
