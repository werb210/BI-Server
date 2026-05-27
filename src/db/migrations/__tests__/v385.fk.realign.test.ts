import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(path.resolve(__dirname, "../2026_05_27_fk_lender_user_realign_v385.sql"), "utf8");

describe("v385 — lender user FK realign migration", () => {
  it("nulls orphans against bi_lender_login_contacts", () => {
    expect(sql).toMatch(/SET created_by_lender_user_id = NULL/);
    expect(sql).toContain("FROM bi_lender_login_contacts");
  });
  it("drops legacy-target fk and re-adds login-contact target", () => {
    expect(sql).toContain("tu.table_name = 'bi_lender_contacts'");
    expect(sql).toContain("DROP CONSTRAINT fk_bi_apps_lender_user");
    expect(sql).toContain("tu.table_name = 'bi_lender_login_contacts'");
    expect(sql).toContain("REFERENCES bi_lender_login_contacts(id)");
  });
});
