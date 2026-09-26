// BI_SERVER_BLOCK_v581_SCHEMA_BASELINE
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fakePool(schemaExists: boolean) {
  const clientCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => { clientCalls.push({ sql, params }); return { rows: [] }; }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("to_regclass('public.bi_applications')")) return { rows: [{ exists: schemaExists }] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
  };
  return { pool, clientCalls };
}

describe("v581 schema baseline", () => {
  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "bi-base-"));
    mkdirSync(path.join(dir, "src/db/migrations"), { recursive: true });
    mkdirSync(path.join(dir, "src/db/baseline"), { recursive: true });
    writeFileSync(path.join(dir, "src/db/migrations/001_a.sql"), "CREATE TABLE a (id int);");
    writeFileSync(path.join(dir, "src/db/migrations/002_b.sql"), "CREATE TABLE b (id int);");
    writeFileSync(path.join(dir, "src/db/baseline/000000_baseline.sql"), "\\restrict abc\nCREATE TABLE public.bi_applications (id text);\n\\unrestrict abc\n");
    process.chdir(dir);
  });

  it("loads the snapshot on an empty database and records every migration without running them", async () => {
    const { runMigrations } = await import("../runMigrations");
    const { pool, clientCalls } = fakePool(false);
    await runMigrations(pool as any);
    const baseline = clientCalls.find((c) => c.sql.includes("CREATE TABLE public.bi_applications"));
    expect(baseline?.sql).not.toContain("restrict");
    expect(clientCalls.some((c) => c.sql === "CREATE TABLE a (id int);")).toBe(false);
    for (const f of ["001_a.sql", "002_b.sql"]) {
      expect(clientCalls.some((c) => c.sql.includes("INSERT INTO bi_migrations_applied") && c.params?.[0] === f)).toBe(true);
    }
  });

  it("never loads the snapshot over an existing schema", async () => {
    const { runMigrations } = await import("../runMigrations");
    const { pool, clientCalls } = fakePool(true);
    await runMigrations(pool as any);
    expect(clientCalls.some((c) => c.sql.includes("CREATE TABLE public.bi_applications"))).toBe(false);
    expect(clientCalls.some((c) => c.sql === "CREATE TABLE a (id int);")).toBe(true);
  });
});
