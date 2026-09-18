// BI_SERVER_BF_REFERRAL_FIELDS_v361
import { describe, it, expect } from "vitest";
import fs from "fs";

const route = fs.readFileSync("src/routes/biApplicationsFromBfRoutes.ts", "utf8");
const sql = fs.readFileSync("src/db/migrations/2026_09_18_bf_referral_fields_v361.sql", "utf8");

describe("BF referrals land with the fields the completion form pre-fills", () => {
  it("inserts country, website, business number and guarantor phone as columns", () => {
    expect(route).toContain("country, business_website, business_number, guarantor_phone,");
    expect(route).toContain("COALESCE($23::text, 'CA'), $24, $25, $26,");
    expect(route).toContain("country, businessWebsite, businessNumber, guarantorPhone, // v361");
  });
  it("only accepts CA or US for country", () => {
    expect(route).toContain('rawCountry === "US" || rawCountry === "CA" ? rawCountry : null');
  });
  it("repairs existing BF referrals idempotently", () => {
    expect(sql).toContain("SET business_number = data->>'business_number'");
    expect(sql).toContain("SET guarantor_phone = applicant_phone_e164");
    expect(sql.match(/source = 'bf_pgi_referral'/g)?.length).toBe(2);
  });
});
