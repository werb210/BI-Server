// BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biPublicApplicationRoutes.ts"), "utf8");

describe("v360 — public application captures referrer attribution", () => {
  it("reads `ref` from body OR ?ref= query", () => {
    expect(src).toMatch(/req\.query\?\.ref/);
    expect(src).toMatch(/b\.ref/);
  });
  it("validates against bi_referrals + soft phone match", () => {
    expect(src).toMatch(/SELECT id, referrer_id, status, email, phone_e164[\s\S]*FROM bi_referrals/);
    expect(src).toMatch(/application_id IS NULL/);
  });
  it("INSERT INTO bi_applications now includes referrer_id + referral_id columns", () => {
    expect(src).toMatch(/referrer_id, referral_id,\s*\n\s*data/);
  });
  it("back-links bi_referrals.application_id after successful insert", () => {
    expect(src).toMatch(/UPDATE bi_referrals[\s\S]*SET application_id = \$1/);
    expect(src).toMatch(/WHEN status = 'invited' THEN 'applied'/);
  });
});
