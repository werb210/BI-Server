import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "src/routes/biMarketingRoutes.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "src/db/migrations/2026_09_14_bi_enrollments_created_at_v171.sql"),
  "utf8",
);

describe("BI_SEQ_ENROLL_DIAG_COLUMN_v171", () => {
  it("no longer reads a column the live table lacks", () => {
    // Postgres threw 42703 "column e.created_at does not exist" on every
    // enroll, so the skip reason never reached the response.
    const diagStart = route.indexOf("bi.marketing.sequences.enroll.skipped");
    const diag = route.slice(Math.max(0, diagStart - 2000), diagStart);
    // Strip SQL comments first: the fix documents the old column by name.
    const sql = diag.replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\be\.created_at\b/);
  });

  it("reads enrolled_at, which the live table does have", () => {
    expect(route).toContain("e.enrolled_at >= NOW() - interval '1 minute'");
  });

  it("explains which of the two table definitions actually applied", () => {
    expect(route).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(route).toContain("v110");
  });

  it("adds the column idempotently rather than recreating the table", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS created_at");
    expect(migration.toUpperCase()).not.toContain("DROP");
    expect(migration.toUpperCase()).not.toContain("TRUNCATE");
  });

  it("backfills from enrolled_at so existing rows are not null", () => {
    expect(migration).toContain("COALESCE(created_at, enrolled_at, NOW())");
  });

  it("still reports the other skip reasons the enroll can produce", () => {
    for (const reason of ["not_found", "no_email", "no_consent_basis", "consent_expired", "suppressed", "already_enrolled"]) {
      expect(route).toContain(`'${reason}'`);
    }
  });
});
