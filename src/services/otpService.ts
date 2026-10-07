import twilio from "twilio";
import { env } from "../platform/env";
import type { Response } from "express";
import { checkOtpSend, OTP_GUARD_MESSAGES, OTP_GUARD_STATUS, type OtpGuardRefusal } from "../lib/otpGuard"; // BI_SERVER_OTP_ABUSE_GUARD_v716

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
export type OtpSendResult = { ok: true } | { ok: false; error: string; refusal?: OtpGuardRefusal };

// BI_SERVER_OTP_ABUSE_GUARD_v716 - one reply for every sign-in route: a guard refusal gets its own
// status and a clear message; anything else is still a 502 from Twilio.
export function otpSendFailed(res: Response, sr: { ok: false; error: string; refusal?: OtpGuardRefusal }) {
  if (sr.refusal) {
    const status = OTP_GUARD_STATUS[sr.refusal];
    if (status === 429) res.setHeader("Retry-After", sr.refusal === "otp_busy" ? "300" : "3600");
    return res.status(status).json({ error: sr.refusal, message: OTP_GUARD_MESSAGES[sr.refusal] });
  }
  return res.status(502).json({ error: "otp_send_failed", detail: sr.error });
}
export type OtpVerifyResult = { ok: true; approved: boolean } | { ok: false; error: string };

// BI_SERVER_BLOCK_v399_OTP_RESEND_DEBOUNCE_v1
// SUPERSEDES the v352 cancel-previous behavior, which was the root cause of
// the "code never works" showstopper. v352 used the Twilio Verify update API
// to mark the previous verification canceled on EVERY send, so any second
// /otp/start for the same phone (a retry, a second browser tab, the lender vs
// applicant flow, or a client auto-fire) canceled the code that was already
// in flight to — or sitting on — the user's handset. Whoever's SMS arrived a
// beat slower lost the race and got 401 invalid_otp.
//
// Twilio Verify already manages this correctly: one pending verification per
// number per service, code valid for the verification's ~10-min lifetime, and
// resends reuse the same verification. So we must NOT cancel. Instead we add a
// tiny in-memory debounce: if we created a verification for this phone within
// the last RESEND_DEBOUNCE_MS, we treat the duplicate start as a no-op success
// and let the existing live code stand. Real "resend" clicks happen many
// seconds later and fall outside the window, so legitimate resends still work.
const RESEND_DEBOUNCE_MS = 15_000;
const recentSendAt = new Map<string, number>();

export async function sendOtpSafe(phone: string): Promise<OtpSendResult> {
  try {
    const now = Date.now();
    const last = recentSendAt.get(phone);
    if (last !== undefined && now - last < RESEND_DEBOUNCE_MS) {
      // A code was just sent and is still live — reuse it, do not create a
      // duplicate verification.
      return { ok: true };
    }
    // BI_SERVER_OTP_ABUSE_GUARD_v716 - Canada/US only, per-number and hourly caps, before Twilio is called.
    const guard = checkOtpSend(phone);
    if (!guard.ok) return { ok: false, error: OTP_GUARD_MESSAGES[guard.reason], refusal: guard.reason };
    recentSendAt.set(phone, now);
    await sendOtp(phone);
    return { ok: true };
  } catch (err: unknown) {
    recentSendAt.delete(phone); // failure → allow an immediate retry
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

export async function verifyOtpSafe(phone: string, code: string): Promise<OtpVerifyResult> {
  try {
    const approved = await verifyOtp(phone, code);
    if (approved) recentSendAt.delete(phone); // consumed — clear debounce
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
