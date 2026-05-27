import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biApplicationRoutes.ts"), "utf8");

describe("BI_SERVER_BLOCK_v386 — pipeline doc_review mapping", () => {
  it("maps document_review to document_review in both CASE blocks", () => {
    const matches = src.match(/WHEN a\.status = 'document_review'\s+THEN 'document_review'/g) ?? [];
    expect(matches.length).toBe(2);
    expect(src).not.toMatch(/WHEN a\.status = 'document_review'\s+THEN 'under_review'/);
  });

  it("includes v386 marker", () => {
    expect(src).toContain("BI_SERVER_BLOCK_v386_PIPELINE_DOC_REVIEW_COLUMN_v1");
  });
});
