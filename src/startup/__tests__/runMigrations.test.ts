import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Build a fake pool with a query-call recorder + a connect() that returns a fake client
function makeFakePool() {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(typeof sql === "string" ? sql.split("\n")[0]!.trim() : "param-query");
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string) => {
      calls.push(typeof sql === "string" ? sql.split("\n")[0]!.trim() : "param-query");
      // Simulate "no migrations applied yet" on the SELECT
      if (typeof sql === "string" && sql.includes("SELECT filename FROM bi_migrations_applied")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
  };
  return { pool, client, calls };
}

describe("BI_MIGRATION_FIX_v56b runMigrations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bi-mig-"));
    mkdirSync(path.join(dir, "src/db/migrations"), { recursive: true });
    process.chdir(dir);
  });

  it("applies .sql files and ignores .ts files", async () => {
    writeFileSync(path.join(dir, "src/db/migrations", "20260101_a.sql"), "CREATE TABLE foo (id int);");
    writeFileSync(path.join(dir, "src/db/migrations", "20260102_b.sql"), "CREATE TABLE bar (id int);");
    writeFileSync(path.join(dir, "src/db/migrations", "00000000000000_bi_baseline.ts"), "// should be ignored");
    writeFileSync(path.join(dir, "src/db/migrations", "README.md"), "notes");

    vi.resetModules();
    const { runMigrations } = await import("../runMigrations");
    const { pool } = makeFakePool();
    // @ts-expect-error — fake pool shape is sufficient for the surface we use
    const r = await runMigrations(pool);

    expect(r.applied).toEqual(["20260101_a.sql", "20260102_b.sql"]);
    expect(r.skipped).toEqual([]);
  });

  it("returns empty when migrations dir is missing", async () => {
    // No migrations dir created
    const dir2 = mkdtempSync(path.join(tmpdir(), "bi-mig-empty-"));
    process.chdir(dir2);

    vi.resetModules();
    const { runMigrations } = await import("../runMigrations");
    const { pool } = makeFakePool();
    // @ts-expect-error
    const r = await runMigrations(pool);

    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});
