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
      logger.error({ err, file }, "runMigrations: failed; rolling back this migration");
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info({ applied: applied.length, skipped: skipped.length }, "runMigrations: complete");
  return { applied, skipped };
}
