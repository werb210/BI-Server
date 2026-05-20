// BI_AUDIT_FIX_v58 — migration runner no longer shells out to npx.
import { Pool } from "pg";
import { env } from "../platform/env";
import { runMigrations as runSqlMigrations } from "../startup/runMigrations";

// BI_BOOT_FIX_v60 — without these timeouts a misconfigured DATABASE_URL
// would let pg.Pool wait forever for a TCP connect, causing bootstrap() to
// hang silently and the Azure log stream to show "No new trace" for 20+ min.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1 — Azure Postgres SLB drops idle
  // connections silently. Keepalive prevents the "Connection terminated
  // due to connection timeout" storms.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on("error", (err: Error) => {
  // Non-fatal: pg-pool replaces the broken connection on the next acquire.
  // Without this listener Node emits an unhandled 'error' and crashes.
  console.error("[pool] idle client error (non-fatal):", err.message);
});

export async function runMigrations(_databaseUrl: string): Promise<void> {
  await runSqlMigrations(pool);
}
