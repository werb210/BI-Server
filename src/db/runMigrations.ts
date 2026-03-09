import { Client } from "pg";
import { runner as migrate } from "node-pg-migrate/dist/legacy";

export async function runMigrations(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await migrate({
    dbClient: client,
    dir: "src/db/migrations",
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
  });

  await client.end();
}
