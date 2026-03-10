import twilio from "twilio";
import { env } from "../platform/env";

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const serviceSid = env.TWILIO_VERIFY_SERVICE_SID;

export async function sendOtp(phone: string) {
  return client.verify.v2.services(serviceSid).verifications.create({ to: phone, channel: "sms" });
}

export async function verifyOtp(phone: string, code: string) {
  const result = await client.verify.v2.services(serviceSid).verificationChecks.create({ to: phone, code });

  return result.status === "approved";
}
