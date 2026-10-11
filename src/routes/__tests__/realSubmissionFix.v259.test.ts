// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
// String-shape assertions for the three failure modes the trace found.
// No DB required — each assertion fails immediately and unambiguously
// if Codex's edit didn't actually land.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
function readMigration(name: string) {
  return readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");
}
function readRoute(name: string) {
  return readFileSync(path.join(REPO_ROOT, "src/routes", name), "utf8");
}

describe("BI_SERVER_BLOCK_v259_v2 — schema additions", () => {
  const sql = readMigration("2026_05_19_real_submission_fix_v259.sql");

  it("adds lender_notes column to bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lender_notes/i);
  });

  it("adds company_name column to bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS company_name/i);
  });

  it("extends bi_document_type with all 7 missing slot keys", () => {
    for (const v of [
      "pl_12mo",
      "forecast",
      "gov_id_primary",
      "gov_id_secondary",
      "annual_y1",
      "annual_y2",
      "annual_y3",
    ]) {
      // each ALTER TYPE ADD VALUE statement must be on its own line so
      // the v66 migration runner's extractor regex matches it
      const re = new RegExp(
        `ALTER\\s+TYPE\\s+bi_document_type\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}';`,
        "i"
      );
      expect(sql, `missing ADD VALUE for ${v}`).toMatch(re);
    }
  });
});
