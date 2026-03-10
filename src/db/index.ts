import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Pool } from "pg";
import { env } from "../platform/env";

const execFileAsync = promisify(execFile);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

export async function runMigrations(databaseUrl: string): Promise<void> {
  await execFileAsync(
    "npx",
    [
      "node-pg-migrate",
      "up",
      "--migrations-dir",
      "src/db/migrations",
      "--database-url",
      databaseUrl
    ]
  );
}
