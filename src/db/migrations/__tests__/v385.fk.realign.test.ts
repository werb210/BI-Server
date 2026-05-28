// BI_SERVER_BLOCK_v107_TEST1_REGRESSION_FIX_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(
  path.resolve(__dirname, "../2026_05_27_fk_lender_user_realign_v385.sql"),
  "utf8",
);

describe("v385 — lender user FK realign migration", () => {
  it("guards on column existence before touching the FK", () => {
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("created_by_lender_user_id");
    expect(sql).toMatch(/DO \$\$/);
  });
  it("drops the legacy FK constraint idempotently", () => {
    expect(sql).toContain(
      "DROP CONSTRAINT IF EXISTS bi_applications_created_by_lender_user_id_fkey",
    );
  });
  it("re-adds the FK pointing at bi_lender_login_contacts with ON DELETE SET NULL", () => {
    expect(sql).toContain(
      "ADD CONSTRAINT bi_applications_created_by_lender_user_id_fkey",
    );
    expect(sql).toContain("REFERENCES bi_lender_login_contacts(id)");
    expect(sql).toMatch(/ON DELETE SET NULL/);
  });
});
