// BI_SERVER_BLOCK_v356_TEST_DB_HARNESS — vitest global setup.
// Runs ONCE before the suite. Builds the schema in the test database via the
// real application migrations, so integration tests run against a schema
// identical to production boot. Refuses any DB whose name is not a test DB.
import { Pool } from "pg";
import { runMigrations } from "./src/startup/runMigrations";

function assertTestDb(url: string): void {
  const dbName = (url.split("/").pop() || "").split("?")[0].toLowerCase();
  if (!/test/.test(dbName)) {
    throw new Error(
      `[vitest globalSetup] Refusing to run migrations against database "${dbName}". ` +
        `Integration tests require a database whose name contains "test".`,
    );
  }
}

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
  if (!url) {
    throw new Error(
      "[vitest globalSetup] DATABASE_URL (or TEST_DATABASE_URL) must be set to a test database.",
    );
  }
  assertTestDb(url);
  process.env.DATABASE_URL = url;
  const pool = new Pool({ connectionString: url });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
