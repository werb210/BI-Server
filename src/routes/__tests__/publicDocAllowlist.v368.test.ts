// BI_SERVER_BLOCK_v368_PUBLIC_DOC_ALLOWLIST_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biPublicApplicationRoutes.ts"), "utf8");

describe("v368 — public doc upload allowlist", () => {
  it("has the 7 carrier-allowed doc types in a Set", () => {
    const m = src.match(/ALLOWED_PUBLIC_DOC_TYPES_v368\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(m).toBeTruthy();
    for (const t of ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"]) {
      expect(m![1]).toContain(`"${t}"`);
    }
  });
  it("returns 400 invalid_doc_type with allowed list on miss", () => {
    expect(src).toMatch(/error:\s*"invalid_doc_type"/);
    expect(src).toMatch(/allowed:\s*Array\.from\(ALLOWED_PUBLIC_DOC_TYPES_v368\)/);
  });
  it("no longer silently defaults to 'other'", () => {
    expect(src).not.toMatch(/\?\s*docTypes\[idx\]\.trim\(\)\s*:\s*"other"/);
  });
});
