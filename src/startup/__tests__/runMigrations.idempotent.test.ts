// BI_MIGRATION_FIX_v60b — pin: when a migration throws "relation already
// exists" the runner must continue, not abort the whole loop.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("BI_MIGRATION_FIX_v60b runMigrations error tolerance", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../runMigrations.ts"), "utf8");

  it("recognises 42P07 (duplicate_table) as already-applied", () => {
    expect(file).toMatch(/"42P07"/);
  });
  it("recognises 42710 (duplicate_object) as already-applied", () => {
    expect(file).toMatch(/"42710"/);
  });
  it("recognises 42701 (duplicate_column) as already-applied", () => {
    expect(file).toMatch(/"42701"/);
  });
  it("uses `continue` to keep iterating after an already-applied error", () => {
    // The continue must be inside the catch block, after the skipped.push.
    const catchBlock = file.split("// BI_MIGRATION_FIX_v60b")[1] ?? "";
    const continueIdx = catchBlock.indexOf("continue;");
    const throwIdx = catchBlock.indexOf("throw err;");
    expect(continueIdx).toBeGreaterThan(0);
    expect(throwIdx).toBeGreaterThan(continueIdx);
  });
  it("records the file in bi_migrations_applied even when we swallow the error", () => {
    // Without this the next cold start would retry the same file and
    // re-encounter the same error — slow no-op. We mark it applied.
    const catchBlock = file.split("// BI_MIGRATION_FIX_v60b")[1] ?? "";
    expect(catchBlock).toMatch(/INSERT INTO bi_migrations_applied/);
  });
});
