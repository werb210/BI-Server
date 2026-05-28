// BI_SERVER_BLOCK_v400_LENDER_OTP_PROVISIONING_404_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../biLenderApiRoutes.ts"),
  "utf8",
);

describe("v400 — /lender/otp/start surfaces lender_not_provisioned", () => {
  it("returns 404 lender_not_provisioned for unprovisioned SMS identifiers", () => {
    // The SMS handler must explicitly 404 when no row matches, not silently
    // return ok and skip the Twilio send.
    expect(src).toMatch(/if \(!r\.rows\[0\]\) {\s*\n?\s*return res\.status\(404\)\.json\(\{ error: "lender_not_provisioned" \}\)/);
  });

  it("returns 404 lender_not_provisioned for unprovisioned email identifiers", () => {
    expect(src).toMatch(/if \(!contact\.rows\[0\]\) {\s*\n?\s*return res\.status\(404\)\.json\(\{ error: "lender_not_provisioned" \}\)/);
  });

  it("no longer wraps sendOtpSafe in an `if (rows[0])` guard that swallows the send", () => {
    // The pre-fix shape was: if (r.rows[0]) { sendOtpSafe... }
    // followed by an unconditional res.json({ ok: true }). That allowed
    // unprovisioned numbers to get 200 with no SMS dispatched.
    expect(src).not.toMatch(/if \(r\.rows\[0\]\) \{\s*\n\s*const sr = await sendOtpSafe/);
    expect(src).not.toMatch(/if \(contact\.rows\[0\]\) \{\s*\n\s*const sr = await sendEmailOtpSafe/);
  });
});
