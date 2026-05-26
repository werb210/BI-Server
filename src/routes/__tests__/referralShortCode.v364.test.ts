// BI_SERVER_BLOCK_v364_REFERRAL_SHORT_CODE_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const referrerSrc = fs.readFileSync(path.resolve(__dirname, "../biReferrerRoutes.ts"), "utf8");
const publicSrc = fs.readFileSync(path.resolve(__dirname, "../biPublicApplicationRoutes.ts"), "utf8");
const migration = fs.readFileSync(path.resolve(__dirname, "../../db/migrations/2026_05_26_referral_short_code_v364.sql"), "utf8");

describe("v364 — referral short_code migration", () => {
  it("adds short_code column conditionally", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS short_code/);
  });
  it("backfills existing rows from id", () => {
    expect(migration).toMatch(/UPDATE bi_referrals[\s\S]*SET short_code\s*=\s*LOWER\(SUBSTRING/);
  });
  it("creates unique index on short_code", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_referrals_short_code_unique/);
  });
});

describe("v364 — referral creation generates short_code", () => {
  it("computes short_code from id (first 8 hex, lowercased)", () => {
    expect(referrerSrc).toMatch(/const shortCode = id\.replace\(\/-\/g, ""\)\.substring\(0, 8\)\.toLowerCase\(\)/);
  });
  it("INSERT includes short_code column", () => {
    expect(referrerSrc).toMatch(/INSERT INTO bi_referrals[\s\S]*short_code[\s\S]*VALUES/);
  });
  it("response includes short_code", () => {
    expect(referrerSrc).toMatch(/short_code:\s*shortCode/);
  });
});

describe("v364 — public submit accepts ref AND ref_code (UUID and short)", () => {
  it("reads ref, ref_code from body + query", () => {
    expect(publicSrc).toMatch(/b\.ref\s*\?\?\s*b\.ref_code\s*\?\?\s*req\.query\?\.ref\s*\?\?\s*req\.query\?\.ref_code/);
  });
  it("UUID detection regex matches the spec", () => {
    expect(publicSrc).toMatch(/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$/i);
  });
  it("non-UUID path queries by short_code, lowercased", () => {
    expect(publicSrc).toMatch(/WHERE short_code = LOWER\(\$1\)/);
  });
});
