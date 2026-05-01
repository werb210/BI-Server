// BI_AUDIT_FIX_v58 — migration runner no longer shells out to npx.
import { Pool } from "pg";
import { env } from "../platform/env";
import { runMigrations as runSqlMigrations } from "../startup/runMigrations";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export async function runMigrations(_databaseUrl: string): Promise<void> {
  await runSqlMigrations(pool);
}
