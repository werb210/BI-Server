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

  // BI_ENROLL_LIVE_COLUMNS_v175 - this asserted the route reads enrolled_at.
  // It does not, and must not: live-schema.json shows the live table is the
  // v280 shape, whose timestamp is started_at. v171 swapped one nonexistent
  // column (created_at) for another (enrolled_at) and left this test pinning
  // the wrong one. Assert the column the live table actually has, and that
  // neither dead name survives outside the explanatory comments.
  it("reads started_at, which is the column the live table has", () => {
    expect(route).toContain("e.started_at >= NOW() - interval '1 minute'");
  });

  it("reads neither dead column name in the diagnostic SQL", () => {
    const diagStart = route.indexOf("bi.marketing.sequences.enroll.skipped");
    const diag = route.slice(Math.max(0, diagStart - 2500), diagStart);
    const sql = diag.replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\be\.created_at\b/);
    expect(sql).not.toMatch(/\be\.enrolled_at\b/);
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

  // BI_ENROLL_LIVE_COLUMNS_v175 - the migration no longer names a source
  // column at author time. Hardcoding enrolled_at is what made it throw 42703
  // and roll back on every boot, so created_at was never actually added.
  // It now resolves the source from information_schema and backfills from
  // whichever of the two twins the live table has.
  it("resolves the backfill source at runtime instead of hardcoding one", () => {
    expect(migration).toContain("information_schema.columns");
    expect(migration).toContain("'started_at', 'enrolled_at'");
    expect(migration).toContain("EXECUTE format(");
    expect(migration).not.toContain("COALESCE(created_at, enrolled_at, NOW())");
  });

  it("leaves created_at non-null once the migration has run", () => {
    expect(migration).toContain("WHERE created_at IS NULL");
    expect(migration).toContain("ALTER COLUMN created_at SET DEFAULT NOW()");
  });

  it("still reports the other skip reasons the enroll can produce", () => {
    for (const reason of ["not_found", "no_email", "no_consent_basis", "consent_expired", "suppressed", "already_enrolled"]) {
      expect(route).toContain(`'${reason}'`);
    }
  });
});
