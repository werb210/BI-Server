// BI_AUDIT_FIX_v58 — migration runner no longer shells out to npx.
import { Pool } from "pg";
import { env } from "../platform/env";
import { runMigrations as runSqlMigrations } from "../startup/runMigrations";

// BI_BOOT_FIX_v60 — without these timeouts a misconfigured DATABASE_URL
// would let pg.Pool wait forever for a TCP connect, causing bootstrap() to
// hang silently and the Azure log stream to show "No new trace" for 20+ min.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on("error", (err) => {
  // Pool-level errors (e.g. dropped client connections) must not crash the
  // process. They're already logged here; individual queries surface their
  // own errors at the call site.
  // eslint-disable-next-line no-console
  console.error("[BI_BOOT_FIX_v60] pg.Pool error:", err.message);
});

export async function runMigrations(_databaseUrl: string): Promise<void> {
  await runSqlMigrations(pool);
}
