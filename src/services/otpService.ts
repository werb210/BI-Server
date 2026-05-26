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
    return env.ALLOW_DEV_OTP === "true" && code === "000000";
  }

  const result = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phone, code });

  return result.status === "approved";
}

// BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1 — email channel.
// Requires the Twilio Verify Service to have email channel configured
// (Twilio Console → Verify → Services → <SID> → Email → Enable). The
// dev fallback path mirrors sendOtp/verifyOtp so local tests still work.
export async function sendEmailOtp(email: string) {
  if (!client || !serviceSid) {
    if (env.NODE_ENV === "production") {
      throw new Error("OTP service not configured in production");
    }
    return { sid: "mock-otp", to: email, status: "pending" };
  }
  return client.verify.v2.services(serviceSid).verifications.create({ to: email, channel: "email" });
}

export async function verifyEmailOtp(email: string, code: string) {
  if (!client || !serviceSid) {
    if (env.NODE_ENV === "production") {
      throw new Error("OTP service not configured in production");
    }
    return env.ALLOW_DEV_OTP === "true" && code === "000000";
  }
  const result = await client.verify.v2.services(serviceSid).verificationChecks.create({ to: email, code });
  return result.status === "approved";
}

// BI_SERVER_BLOCK_v278_OTP_ERROR_HARDENING_v1
// Discriminated-result wrappers. Never throw — Twilio failures
// become {ok:false, error} which route handlers convert to a 502
// with a user-facing code instead of exposing Twilio internals.
export type OtpSendResult = { ok: true } | { ok: false; error: string };
export type OtpVerifyResult = { ok: true; approved: boolean } | { ok: false; error: string };

// BI_SERVER_BLOCK_v352_OTP_AND_PHONE_PREFILL_v1
// Cancel any active Twilio Verify session for this phone before creating
// a new one. Without this, sign-out -> re-OTP creates parallel sessions
// and users entering the code from the OLD SMS get 401 invalid_otp
// because the older session is in "approved" or "pending" state.
//
// Twilio Verify behavior:
// - Each `verifications.create` call returns a Verification with a SID
//   and status "pending". Each session lives for 10 minutes.
// - You CAN cancel a pending verification with
//   `verifications(sid).update({ status: "canceled" })`.
// - But Twilio does NOT expose a "list verifications by phone" API, so we
//   can't enumerate prior sessions to cancel them. Best-effort approach:
//   we maintain a tiny in-memory map of latest verification SID per phone
//   and cancel it before each new send. Survives restarts only weakly,
//   but covers the immediate-resend case which is the actual reported
//   bug (sign-out -> re-OTP within seconds).
const lastSid = new Map<string, string>();

async function cancelPreviousVerificationFor(phone: string): Promise<void> {
  const sid = lastSid.get(phone);
  if (!sid) return;
  lastSid.delete(phone);
  if (!client || !serviceSid) return;
  try {
    await client.verify.v2.services(serviceSid).verifications(sid).update({ status: "canceled" });
  } catch {
    // Not-found / already-final → ignore. Don't throw, this is best-effort.
  }
}

export async function sendOtpSafe(phone: string): Promise<OtpSendResult> {
  try {
    await cancelPreviousVerificationFor(phone);
    const created = await sendOtp(phone);
    // Twilio's TS types vary by SDK version; tolerate either { sid } or a
    // .sid property on the returned object.
    const sid = (created as any)?.sid;
    if (typeof sid === "string" && sid.length > 0) lastSid.set(phone, sid);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

export async function verifyOtpSafe(phone: string, code: string): Promise<OtpVerifyResult> {
  try {
    const approved = await verifyOtp(phone, code);
    return { ok: true, approved };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

// BI_SERVER_BLOCK_56_EMAIL_OTP_APOLLO_HEALTH_NAME_v1 — email-channel wrappers.
export async function sendEmailOtpSafe(email: string): Promise<OtpSendResult> {
  try {
    await sendEmailOtp(email);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

export async function verifyEmailOtpSafe(email: string, code: string): Promise<OtpVerifyResult> {
  try {
    const approved = await verifyEmailOtp(email, code);
    return { ok: true, approved };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}
