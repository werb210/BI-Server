// BI_SERVER_BLOCK_v366_NOTIFICATION_SMS_v2
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const referrerSrc = fs.readFileSync(path.resolve(__dirname, "../../routes/biReferrerRoutes.ts"), "utf8");
const publicSrc = fs.readFileSync(path.resolve(__dirname, "../../routes/biPublicApplicationRoutes.ts"), "utf8");
const hookSrc = fs.readFileSync(path.resolve(__dirname, "../pgiOnApprovedHook.ts"), "utf8");

describe("v366 — Referral invite SMS", () => {
  it("uses real sendOutreachSms (not invented sendBiSms)", () => {
    expect(referrerSrc).toMatch(/sendOutreachSms/);
    expect(referrerSrc).not.toMatch(/sendBiSms/);
  });
  it("fires only when phone is present", () => {
    expect(referrerSrc).toMatch(/if \(phone\) \{[\s\S]*sendOutreachSms\(phone,/);
  });
  it("invite URL includes the short_code", () => {
    expect(referrerSrc).toMatch(/applications\/new\?ref=\$\{shortCode\}/);
  });
  it("stamps sms_sent_at on success", () => {
    expect(referrerSrc).toMatch(/UPDATE bi_referrals SET sms_sent_at = NOW\(\)/);
  });
  it("SMS happens after COMMIT (outside the transaction)", () => {
    const commitIdx = referrerSrc.indexOf('await client.query("COMMIT")');
    const smsIdx = referrerSrc.indexOf("Invite SMS — outside the transaction");
    expect(commitIdx).toBeGreaterThan(-1);
    expect(smsIdx).toBeGreaterThan(commitIdx);
  });
});

describe("v366 — Submit confirmation SMS", () => {
  it("uses sendOutreachSms", () => {
    expect(publicSrc).toMatch(/sendOutreachSms/);
  });
  it("fires only when applicant_phone_e164 present", () => {
    // BI_UNQUARANTINE_SOURCE_REGEX_v1
    // v382 widened this guard. applicant_phone_e164 is NULL for virtually
    // every public applicant - the website form collects guarantor_phone - so
    // the old condition meant the confirmation SMS reached almost nobody.
    // Assert the behaviour (a phone is resolved, then sent to) rather than the
    // exact expression, which is what made this brittle in the first place.
    expect(publicSrc).toMatch(/app\.applicant_phone_e164\s*\|\|\s*app\.guarantor_phone/);
    expect(publicSrc).toMatch(/if \(submitSmsTo\) \{[\s\S]*sendOutreachSms\(submitSmsTo,/);
  });
  it("includes the docs upload link", () => {
    expect(publicSrc).toMatch(/applications\/\$\{app\.public_id\}\/documents/);
  });
});

describe("v366 — Policy.bound SMS in pgiOnApprovedHook", () => {
  it("uses sendOutreachSms", () => {
    expect(hookSrc).toMatch(/sendOutreachSms/);
  });
  it("notifies the applicant", () => {
    expect(hookSrc).toMatch(/APPROVED and bound/);
  });
  it("notifies the referrer when referrer_id is set", () => {
    expect(hookSrc).toMatch(/if \(app\.referrer_id\)/);
    expect(hookSrc).toMatch(/bound a PGI policy/);
  });
  it("each SMS call has its own .catch so failures are isolated", () => {
    expect(hookSrc).toMatch(/applicant bound SMS failed/);
    expect(hookSrc).toMatch(/referrer bound SMS failed/);
  });
  it("preserves the existing DB updates from BI_BLOCK_PGI_ALIGNMENT_v1", () => {
    expect(hookSrc).toMatch(/UPDATE bi_referrals SET status='approved'/);
    expect(hookSrc).toMatch(/UPDATE bi_contacts c SET tags/);
  });
});
