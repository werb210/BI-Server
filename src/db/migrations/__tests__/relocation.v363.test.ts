// BI_SERVER_BLOCK_v363_RELOCATE_MIGRATIONS_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("v363 — v359 + v360 migrations are at the canonical path", () => {
  it("v359 lives in src/db/migrations/", () => {
    const p = path.resolve(__dirname, "../2026_05_26_pgi_document_tracking_v359.sql");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toMatch(/pgi_document_id/);
  });
  it("v360 lives in src/db/migrations/", () => {
    const p = path.resolve(__dirname, "../2026_05_26_referrer_attribution_v360.sql");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toMatch(/bi_referrals_status_check/);
  });
  it("the wrong-path copies are gone", () => {
    const repoRoot = path.resolve(__dirname, "../../../../");
    expect(fs.existsSync(path.join(repoRoot, "migrations/2026_05_26_pgi_document_tracking_v359.sql"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "migrations/2026_05_26_referrer_attribution_v360.sql"))).toBe(false);
  });
});
