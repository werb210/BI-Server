// BI_SERVER_BLOCK_v352_OTP_AND_PHONE_PREFILL_v1
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

describe("v352 — Twilio Verify session cancellation on re-OTP", () => {
  it("sendOtpSafe cancels previous verification before creating a new one", () => {
    expect(otpSrc).toMatch(/cancelPreviousVerificationFor/);
  });
  it("cancellation is best-effort (does not throw)", () => {
    expect(otpSrc).toMatch(/} catch \{\s*\/\/[^}]*\}/);
  });
  it("stores the latest verification SID per phone in lastSid map", () => {
    expect(otpSrc).toMatch(/lastSid\.set\(phone, sid\)/);
  });
});
