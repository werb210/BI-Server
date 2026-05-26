// BI_SERVER_BLOCK_v371_DOC_UNIQUE_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const sql = fs.readFileSync(path.resolve(__dirname, "../2026_05_26_doc_unique_v371.sql"), "utf8");
const publicRoute = fs.readFileSync(path.resolve(__dirname, "../../../routes/biPublicApplicationRoutes.ts"), "utf8");
const lenderRoute = fs.readFileSync(path.resolve(__dirname, "../../../routes/biLenderApiRoutes.ts"), "utf8");

describe("v371 — migration", () => {
  it("dedupes existing data before adding unique index", () => {
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY application_id, doc_type/);
  });
  it("partial unique index on (application_id, doc_type) WHERE purged_at IS NULL", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_documents_app_doctype_unique[\s\S]*WHERE purged_at IS NULL/);
  });
});

describe("v371 — upload routes use ON CONFLICT DO UPDATE", () => {
  it("public path replaces on conflict", () => {
    expect(publicRoute).toMatch(/ON CONFLICT \(application_id, doc_type\) WHERE purged_at IS NULL/);
  });
  it("lender path replaces on conflict", () => {
    expect(lenderRoute).toMatch(/ON CONFLICT \(application_id, doc_type\) WHERE purged_at IS NULL/);
  });
  it("re-upload resets carrier-forwarding state", () => {
    expect(publicRoute).toMatch(/pgi_document_id = NULL/);
    expect(publicRoute).toMatch(/forwarded_to_carrier_at = NULL/);
  });
});
