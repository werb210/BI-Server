// BI_SERVER_BLOCK_v789_MIGRATION_FAILS_CLOSED
// Replaces runMigrations.idempotent.test.ts (which grepped the runner source for the
// "already exists" escape hatch). Behaviour: a migration file that raises - including the
// duplicate_* codes the runner used to swallow - is rolled back, never recorded in
// bi_migrations_applied, stops the run, and the error reaches the caller.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Call = { via: "pool" | "client"; sql: string; params?: unknown[] };

function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

// The fake answers by SQL content: the "bad" migration body throws `failure`, everything else
// succeeds. The ledger already holds one unrelated file so the baseline path is not taken.
function fakePool(failure: Error) {
  const calls: Call[] = [];
  const answer = async (via: Call["via"], sql: string, params?: unknown[]) => {
    calls.push({ via, sql, params });
    if (sql.includes("CREATE TABLE bad")) throw failure;
    if (sql.includes("SELECT filename FROM bi_migrations_applied")) return { rows: [{ filename: "000_old.sql" }] };
    return { rows: [] };
  };
  const client = { query: vi.fn((sql: string, params?: unknown[]) => answer("client", sql, params)), release: vi.fn() };
  const pool = { query: vi.fn((sql: string, params?: unknown[]) => answer("pool", sql, params)), connect: vi.fn(async () => client) };
  return { pool, client, calls };
}

function recorded(calls: Call[]): unknown[] {
  return calls.filter((c) => c.sql.includes("INSERT INTO bi_migrations_applied")).map((c) => c.params?.[0]);
}

describe("v789 runMigrations fails closed", () => {
  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "bi-mig-v789-"));
    mkdirSync(path.join(dir, "src/db/migrations"), { recursive: true });
    writeFileSync(path.join(dir, "src/db/migrations/001_good.sql"), "CREATE TABLE IF NOT EXISTS good (id int);");
    writeFileSync(path.join(dir, "src/db/migrations/002_bad.sql"), "CREATE TABLE bad (id int);");
    writeFileSync(path.join(dir, "src/db/migrations/003_after.sql"), "CREATE TABLE IF NOT EXISTS after_bad (id int);");
    process.chdir(dir);
    vi.resetModules();
  });

  for (const code of ["42P07", "42710", "42701", "42P06", "42723", "42P16"]) {
    it(`an "already exists" error (${code}) throws, rolls back and is not recorded`, async () => {
      const { runMigrations } = await import("../runMigrations");
      const failure = pgError(code, "already exists");
      const { pool, client, calls } = fakePool(failure);

      await expect(runMigrations(pool as never)).rejects.toBe(failure);

      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(recorded(calls)).toEqual(["001_good.sql"]);
      expect(calls.some((c) => c.sql.includes("after_bad"))).toBe(false);
      // every connection taken was released
      expect(client.release.mock.calls.length).toBe(pool.connect.mock.calls.length);
    });
  }

  it("any other error also throws without recording the file", async () => {
    const { runMigrations } = await import("../runMigrations");
    const failure = pgError("42601", "syntax error");
    const { pool, client, calls } = fakePool(failure);

    await expect(runMigrations(pool as never)).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(recorded(calls)).not.toContain("002_bad.sql");
    expect(calls.some((c) => c.sql === "COMMIT" && c.via === "client")).toBe(true); // 001 only
  });

  it("a failing ROLLBACK does not mask the original error", async () => {
    const { runMigrations } = await import("../runMigrations");
    const failure = pgError("42P07", "already exists");
    const { pool, client } = fakePool(failure);
    const base = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === "ROLLBACK") throw new Error("connection lost");
      return base(sql, params);
    });

    await expect(runMigrations(pool as never)).rejects.toBe(failure);
  });

  it("clean files are applied and recorded in order", async () => {
    writeFileSync(path.join(process.cwd(), "src/db/migrations/002_bad.sql"), "CREATE TABLE IF NOT EXISTS fine (id int);");
    const { runMigrations } = await import("../runMigrations");
    const { pool, calls } = fakePool(new Error("unused"));

    const r = await runMigrations(pool as never);
    expect(r.applied).toEqual(["001_good.sql", "002_bad.sql", "003_after.sql"]);
    expect(recorded(calls)).toEqual(["001_good.sql", "002_bad.sql", "003_after.sql"]);
  });
});
