// BI_SERVER_BF_PHONE_v282
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeE164 } from "../util/phoneE164";

describe("BF referral phone", () => {
  it("the formatted BF wizard phone becomes the E.164 number applicants sign in with", () => {
    expect(normalizeE164("(780) 916-7413")).toBe("+17809167413");
  });
  it("is normalised on intake and repaired for existing referrals", () => {
    const route = readFileSync("src/routes/biApplicationsFromBfRoutes.ts", "utf-8");
    expect(route).toContain("const guarantorPhone = normalizeE164(s(b.guarantor_phone) ?? \"\") ?? s(b.guarantor_phone);");
    const sql = readFileSync("src/db/migrations/2026_09_16_v282_bf_referral_phone_repair.sql", "utf-8");
    expect(sql).toContain("WHERE source = 'bf_pgi_referral'");
    expect(sql).toContain("'+1' || d.digits");
  });
});
