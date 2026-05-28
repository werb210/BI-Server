// BI_SERVER_BLOCK_v352_OTP_AND_PHONE_PREFILL_v1
// Cancellation assertions superseded by BI_SERVER_BLOCK_v399_OTP_RESEND_DEBOUNCE_v1.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const flowSrc = fs.readFileSync(
  path.resolve(__dirname, "../biApplicantDocFlowRoutes.ts"),
  "utf8",
);
const otpSrc = fs.readFileSync(
  path.resolve(__dirname, "../../services/otpService.ts"),
  "utf8",
);

describe("v352 — phone pre-fill on /applicants/me/pending-application", () => {
  it("response includes phone (whether or not a pending app row exists)", () => {
    expect(flowSrc).toMatch(/phone:\s*req\.applicantPhone/);
    expect(flowSrc).toMatch(/return res\.json\(\{\s*pending:\s*null,\s*phone\s*\}\)/);
  });
});

describe("v399 — OTP resend debounce (no cancel-on-send)", () => {
  it("does NOT cancel the previous verification", () => {
    expect(otpSrc).not.toMatch(/cancelPreviousVerificationFor/);
    expect(otpSrc).not.toMatch(/status:\s*["']canceled["']/);
  });
  it("debounces duplicate sends with an in-memory recentSendAt map", () => {
    expect(otpSrc).toMatch(/recentSendAt/);
    expect(otpSrc).toMatch(/RESEND_DEBOUNCE_MS/);
  });
  it("clears the debounce once a code is approved", () => {
    expect(otpSrc).toMatch(/if \(approved\) recentSendAt\.delete\(phone\)/);
  });
});
