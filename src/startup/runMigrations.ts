// BI_MIGRATION_FIX_v56b — direct .sql migration runner.
// Replaces the previous "npx node-pg-migrate" shell-out, which crashed in
// production because the deployed Node runtime cannot load .ts migration files.
//
// Behavior:
//   - Reads every *.sql file in src/db/migrations/, sorted lexicographically
//   - Skips anything that isn't a .sql file (including stray .ts, .md, .DS_Store)
//   - Tracks applied filenames in bi_migrations_applied (auto-created)
//   - Runs each unapplied migration inside a transaction
//   - On error: ROLLBACK that one migration, log, throw — the BI server treats
//     this as non-blocking via its existing try/catch in src/index.ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { logger } from "../platform/logger";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS bi_migrations_applied (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// BI_SERVER_BLOCK_v66_MIGRATION_RUNNER_ENUM_SAFE_v1
// Extract every standalone ALTER TYPE … ADD VALUE statement from a .sql
// file body so the runner can pre-commit them OUTSIDE the per-file
// transaction. Postgres permits ADD VALUE inside a tx, but rejects USING
// the new value before commit (error 55P04). Pre-committing eliminates the
// hazard regardless of how the .sql author structured the file.
//
// Conservative regex:
//   - Matches ALTER TYPE <name> ADD VALUE [IF NOT EXISTS] '<value>' [BEFORE/AFTER '<other>']
//   - Case-insensitive, multiline
//   - Does NOT strip the matched statement from the file body — Postgres
//     re-runs ADD VALUE IF NOT EXISTS as a no-op on the second pass inside
//     the per-file BEGIN…COMMIT, which is safe.
function extractAddValueStatements_v66(sql: string): string[] {
  const out: string[] = [];
  const re = /ALTER\s+TYPE\s+[a-zA-Z0-9_."]+\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+'[^']+'(?:\s+(?:BEFORE|AFTER)\s+'[^']+')?\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  return out;
}

export async function runMigrations(pool: Pool): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];

  // 1. Ensure tracking table exists
  await pool.query(ENSURE_TABLE_SQL);

  // 2. List candidate files; only .sql, sorted
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    logger.warn({ err, dir: MIGRATIONS_DIR }, "runMigrations: migrations dir not found, skipping");
    return { applied, skipped };
  }
  const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();
  logger.info({ count: sqlFiles.length, dir: MIGRATIONS_DIR }, "runMigrations: found .sql migrations");

  // 3. Fetch already-applied set
  const { rows } = await pool.query<{ filename: string }>(`SELECT filename FROM bi_migrations_applied`);
  const alreadyApplied = new Set(rows.map((r) => r.filename));

  // 4. Apply each unapplied migration in its own transaction
  for (const file of sqlFiles) {
    if (alreadyApplied.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // BI_SERVER_BLOCK_v66_MIGRATION_RUNNER_ENUM_SAFE_v1 — pre-commit any
    // ALTER TYPE ... ADD VALUE statements OUTSIDE the per-file transaction.
    // Postgres rejects USING a newly-added enum value before its xact has
    // committed; running them via pool.query (autocommit) ensures any later
    // statement in the same boot run sees a committed value.
    const addValueStmts = extractAddValueStatements_v66(sql);
    for (const stmt of addValueStmts) {
      try {
        await pool.query(stmt);
      } catch (err) {
        // ADD VALUE IF NOT EXISTS is idempotent; only log if it's an
        // unexpected failure. Actual schema errors will surface again
        // below when the per-file transaction tries to use the value.
        logger.warn({ err, file, stmt }, "runMigrations: pre-commit ADD VALUE skipped");
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO bi_migrations_applied (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
      await client.query("COMMIT");
      applied.push(file);
      logger.info({ file }, "runMigrations: applied");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // BI_MIGRATION_FIX_v60b — Treat object-already-exists errors as
      // "this migration's effect is already in the schema; skip and move on."
      // Postgres error codes:
      //   42P07 duplicate_table          (CREATE TABLE without IF NOT EXISTS)
      //   42710 duplicate_object         (CREATE TYPE / extension etc)
      //   42701 duplicate_column         (ALTER TABLE ... ADD COLUMN dup)
      //   42P06 duplicate_schema
      //   42723 duplicate_function
      //   42P16 invalid_table_definition (occasionally raised on column dup)
      const code = (err as { code?: string } | null)?.code;
      const ALREADY_APPLIED = new Set(["42P07", "42710", "42701", "42P06", "42723", "42P16"]);
      if (code && ALREADY_APPLIED.has(code)) {
        // Mark as applied so future cold-starts don't re-attempt it.
        await pool.query(
          `INSERT INTO bi_migrations_applied (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
          [file],
        );
        skipped.push(file);
        logger.warn({ file, code }, "runMigrations: object already exists; marking applied and continuing");
        continue;
      }
      logger.error({ err, file }, "runMigrations: failed; rolling back this migration");
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info({ applied: applied.length, skipped: skipped.length }, "runMigrations: complete");
  return { applied, skipped };
}
