import twilio from "twilio";
import { env } from "../platform/env";

const hasTwilioConfig =
  Boolean(env.TWILIO_ACCOUNT_SID) &&
  Boolean(env.TWILIO_AUTH_TOKEN) &&
  Boolean(env.TWILIO_VERIFY_SERVICE_SID);

const client = hasTwilioConfig ? twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!) : null;
const serviceSid = env.TWILIO_VERIFY_SERVICE_SID;

export async function sendOtp(phone: string) {
  if (!client || !serviceSid) {
    if (env.NODE_ENV === "production") {
      throw new Error("OTP service not configured in production");
    }
    return { sid: "mock-otp", to: phone, status: "pending" };
  }

  return client.verify.v2.services(serviceSid).verifications.create({ to: phone, channel: "sms" });
}

export async function verifyOtp(phone: string, code: string) {
  if (!client || !serviceSid) {
    if (env.NODE_ENV === "production") {
      throw new Error("OTP service not configured in production");
    }
    return code === "000000";
  }

  const result = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phone, code });

  return result.status === "approved";
}
