// BI_SERVER_BLOCK_v361_CRON_COLUMN_FIX_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biJobs.ts"), "utf8");

describe("v361 — docs reminder cron column fix", () => {
  it("query no longer references non-existent a.pipeline_stage column", () => {
    expect(src).not.toMatch(/a\.pipeline_stage/);
  });
  it("status filter now covers created + in_progress + document_review", () => {
    expect(src).toMatch(/a\.status IN \('created', 'in_progress', 'document_review'\)/);
  });
  it("limits to source='public' (lender + referrer paths auto-submit)", () => {
    expect(src).toMatch(/a\.source = 'public'/);
  });
  it("HAVING COUNT(d.id) = 0 still gates on no-docs-uploaded", () => {
    expect(src).toMatch(/HAVING COUNT\(d\.id\) = 0/);
  });
});
