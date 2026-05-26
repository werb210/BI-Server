// BI_SERVER_BLOCK_v356_QUARANTINE_USERS_MIGRATION_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(
  path.resolve(__dirname, "../migrations/2026_05_21_users_deleted_at_v470.sql"),
  "utf8",
);

describe("v356 — v470 users.deleted_at migration is now a safe-no-op when users table absent", () => {
  it("uses a DO block with IF EXISTS guard against information_schema.tables", () => {
    expect(sql).toMatch(/DO \$\$/);
    expect(sql).toMatch(/IF EXISTS \([\s\S]*FROM information_schema\.tables/);
    expect(sql).toMatch(/table_name\s*=\s*'users'/);
  });

  it("contains the original ALTER TABLE inside the guard", () => {
    expect(sql).toMatch(/ALTER TABLE users[\s\S]*ADD COLUMN IF NOT EXISTS deleted_at/);
  });

  it("has no top-level ALTER TABLE users (would still fail on bi-server)", () => {
    // Strip the DO block, then assert no naked ALTER TABLE remains.
    const stripped = sql.replace(/DO \$\$[\s\S]*?\$\$;/g, "");
    expect(stripped).not.toMatch(/ALTER TABLE users/);
  });

  it("emits a clear notice on each branch (helps log triage)", () => {
    expect(sql).toMatch(/RAISE NOTICE 'v470 users\.deleted_at applied'/);
    expect(sql).toMatch(/RAISE NOTICE 'v470 users\.deleted_at skipped/);
  });

  it("CREATE INDEX is also inside the guard + uses IF NOT EXISTS (idempotent)", () => {
    const doBlock = sql.match(/DO \$\$[\s\S]*?\$\$;/);
    expect(doBlock).toBeTruthy();
    expect(doBlock![0]).toMatch(/CREATE INDEX IF NOT EXISTS users_deleted_at_idx/);
  });
});
