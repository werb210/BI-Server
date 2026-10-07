// BI_SERVER_OTP_ABUSE_GUARD_v716
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { isAllowedOtpDestination, checkOtpSend, _resetOtpGuard } from "../otpGuard";
import { rateLimitKeyFromRequest } from "../../middleware/rateLimitKey";
import { sendOtpSafe, otpSendFailed } from "../../services/otpService";

describe("BI sign-in codes only go to Canadian and US numbers", () => {
  beforeEach(() => _resetOtpGuard());
  it("allows Canada/US and refuses the Oct 7 countries and Caribbean +1 numbers", () => {
    expect(isAllowedOtpDestination("+14035550100")).toBe(true);
    expect(isAllowedOtpDestination("+50937001234")).toBe(false);
    expect(isAllowedOtpDestination("+50255501234")).toBe(false);
    expect(isAllowedOtpDestination("+18765550100")).toBe(false);
    expect(isAllowedOtpDestination("+18095550100")).toBe(false);
  });
  it("sendOtpSafe refuses before Twilio is called", async () => {
    const r = await sendOtpSafe("+50937001234");
    expect(r).toMatchObject({ ok: false, refusal: "unsupported_country" });
  });
  it("otpSendFailed replies 400/429 with a message for refusals, 502 otherwise", () => {
    const calls: any = {};
    const res: any = { setHeader: (k: string, v: string) => { calls.header = [k, v]; }, status: (s: number) => { calls.status = s; return res; }, json: (b: unknown) => { calls.body = b; return res; } };
    otpSendFailed(res, { ok: false, error: "x", refusal: "unsupported_country" });
    expect(calls.status).toBe(400);
    expect(calls.body.error).toBe("unsupported_country");
    otpSendFailed(res, { ok: false, error: "x", refusal: "otp_busy" });
    expect(calls.status).toBe(429);
    expect(calls.header).toEqual(["Retry-After", "300"]);
    otpSendFailed(res, { ok: false, error: "twilio down" });
    expect(calls.status).toBe(502);
  });
});

describe("BI caps", () => {
  beforeEach(() => { _resetOtpGuard(); delete process.env.OTP_HOURLY_CAP; });
  afterEach(() => { _resetOtpGuard(); delete process.env.OTP_HOURLY_CAP; });
  it("8 per number per day, and an hourly breaker across all numbers", () => {
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 8; i++) expect(checkOtpSend("+14035550100", { now: t0 + i })).toEqual({ ok: true });
    expect(checkOtpSend("+14035550100", { now: t0 + 9 })).toEqual({ ok: false, reason: "otp_phone_daily_limit" });
    _resetOtpGuard();
    process.env.OTP_HOURLY_CAP = "3";
    for (let i = 0; i < 3; i++) expect(checkOtpSend("+1403555011" + i, { now: t0 })).toEqual({ ok: true });
    expect(checkOtpSend("+14035550199", { now: t0 })).toEqual({ ok: false, reason: "otp_busy" });
  });
});

describe("BI rate-limit key cannot be forged", () => {
  it("uses the last public hop, not the caller-written first one", () => {
    expect(rateLimitKeyFromRequest({ headers: { "x-forwarded-for": "1.2.3.4, 77.246.52.163:62553" } } as any)).toBe("77.246.52.163");
    expect(rateLimitKeyFromRequest({ headers: { "x-forwarded-for": "1.2.3.4, 77.246.52.163:62553, 10.0.0.4" } } as any)).toBe("77.246.52.163");
  });
  it("every public sign-in route replies through otpSendFailed", () => {
    for (const f of ["biReferrerRoutes.ts", "biAuthRoutes.ts", "biApplicantOtpRoutes.ts", "biLenderAuthRoutes.ts", "biLenderApiRoutes.ts"]) {
      expect(readFileSync("src/routes/" + f, "utf8")).toContain("otpSendFailed(res,");
    }
  });
});
