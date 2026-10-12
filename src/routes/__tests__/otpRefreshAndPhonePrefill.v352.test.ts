// BI_SERVER_BLOCK_v352_OTP_AND_PHONE_PREFILL_v1
// Cancellation assertions superseded by BI_SERVER_BLOCK_v399_OTP_RESEND_DEBOUNCE_v1.
// v789 [5]/[37]: the otpService.ts greps are now calls to sendOtpSafe /
// verifyOtpSafe against a mocked Twilio Verify client. The phone pre-fill case
// reads biApplicantDocFlowRoutes.ts, which is outside this rewrite's changed
// set, and stays a source check.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const twilioMock = vi.hoisted(() => {
  const create = vi.fn(async () => ({ sid: "VE1", status: "pending" }));
  const update = vi.fn(async () => ({ status: "canceled" }));
  const check = vi.fn(async () => ({ status: "approved" }));
  // Twilio's verifications is both callable (verifications(sid).update) and has .create.
  const verifications = Object.assign(vi.fn(() => ({ update })), { create });
  const services = vi.fn(() => ({ verifications, verificationChecks: { create: check } }));
  return { create, update, check, verifications, factory: vi.fn(() => ({ verify: { v2: { services } } })) };
});
vi.mock("twilio", () => ({ default: twilioMock.factory }));
vi.mock("../../platform/env", () => ({
  env: { NODE_ENV: "test", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "auth_test", TWILIO_VERIFY_SERVICE_SID: "VA_test" },
}));

import { sendOtpSafe, verifyOtpSafe } from "../../services/otpService";
import { _resetOtpGuard } from "../../lib/otpGuard";

const flowSrc = fs.readFileSync(
  path.resolve(__dirname, "../biApplicantDocFlowRoutes.ts"),
  "utf8",
);

describe("v352 - phone pre-fill on /applicants/me/pending-application", () => {
  it("response includes phone (whether or not a pending app row exists)", () => {
    expect(flowSrc).toMatch(/phone:\s*req\.applicantPhone/);
    expect(flowSrc).toMatch(/return res\.json\(\{\s*pending:\s*null,\s*phone\s*\}\)/);
  });
});

describe("v399 - OTP resend debounce (no cancel-on-send)", () => {
  let now = Date.parse("2026-10-11T12:00:00Z");
  beforeEach(() => {
    _resetOtpGuard();
    twilioMock.create.mockClear();
    twilioMock.update.mockClear();
    twilioMock.check.mockClear();
    twilioMock.verifications.mockClear();
    now += 3_600_000; // a fresh window for every test (the debounce map is module state)
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does NOT cancel the previous verification", async () => {
    expect(await sendOtpSafe("+14035550101")).toEqual({ ok: true });
    now += 20_000; // a real resend, outside the debounce window
    expect(await sendOtpSafe("+14035550101")).toEqual({ ok: true });
    expect(twilioMock.create).toHaveBeenCalledTimes(2);
    expect(twilioMock.verifications).not.toHaveBeenCalled();
    expect(twilioMock.update).not.toHaveBeenCalled();
  });

  it("debounces duplicate sends inside the resend window", async () => {
    expect(await sendOtpSafe("+14035550102")).toEqual({ ok: true });
    now += 5_000;
    expect(await sendOtpSafe("+14035550102")).toEqual({ ok: true });
    expect(twilioMock.create).toHaveBeenCalledTimes(1);
    now += 11_000; // 16s after the first send
    expect(await sendOtpSafe("+14035550102")).toEqual({ ok: true });
    expect(twilioMock.create).toHaveBeenCalledTimes(2);
  });

  it("clears the debounce once a code is approved", async () => {
    expect(await sendOtpSafe("+14035550103")).toEqual({ ok: true });
    expect(await verifyOtpSafe("+14035550103", "123456")).toEqual({ ok: true, approved: true });
    now += 1_000;
    expect(await sendOtpSafe("+14035550103")).toEqual({ ok: true });
    expect(twilioMock.create).toHaveBeenCalledTimes(2);
  });

  it("a failed send does not hold the debounce", async () => {
    twilioMock.create.mockRejectedValueOnce(new Error("twilio down"));
    expect(await sendOtpSafe("+14035550104")).toMatchObject({ ok: false });
    expect(await sendOtpSafe("+14035550104")).toEqual({ ok: true });
    expect(twilioMock.create).toHaveBeenCalledTimes(2);
  });
});
