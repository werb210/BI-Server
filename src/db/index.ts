import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Pool } from "pg";
import { ENV } from "../config/env";

const execFileAsync = promisify(execFile);

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
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
    ],
    { env: process.env }
  );
}
