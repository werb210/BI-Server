import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
function migration(name: string) {
  return readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");
}

describe("Block 113 migrations", () => {
  it("repairs v110 by recreating bi_user_send_quotas", () => {
    const sql = migration("2026_05_18_bi_v113_repair.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS bi_user_send_quotas/i);
  });

  it("converts orphan contacts by creating companies and setting converted_to_company_id", () => {
    const sql = migration("2026_05_18_bi_orphan_company_cleanup_v113.sql");
    expect(sql).toMatch(/RAISE NOTICE 'Block 113 orphan-company cleanup: candidate orphan contacts before=%'/);
    expect(sql).toMatch(/INSERT INTO bi_companies/i);
    expect(sql).toMatch(/SET converted_to_company_id/i);
  });
});
