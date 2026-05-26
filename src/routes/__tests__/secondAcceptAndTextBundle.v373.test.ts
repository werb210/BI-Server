// BI_SERVER_BLOCK_v373_SECOND_ACCEPT_AND_TEXT_BUNDLE_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const detailSrc = fs.readFileSync(path.resolve(__dirname, "../biApplicationDetailRoutes.ts"), "utf8");
const submitSrc = fs.readFileSync(path.resolve(__dirname, "../../services/biPgiSubmissionService.ts"), "utf8");

describe("v373 — duplicate doc-accept handler now backfills (Bug #22)", () => {
  it("biApplicationDetailRoutes calls pgiUploadDocument", () => {
    expect(detailSrc).toMatch(/pgiUploadDocument/);
  });
  it("backfill block runs only on source_type='public'", () => {
    expect(detailSrc).toMatch(/doc\.source_type === "public"[\s\S]*pendingDocs/);
  });
  it("updates bi_documents.pgi_document_id after backfill", () => {
    expect(detailSrc).toMatch(/UPDATE bi_documents SET pgi_document_id = \$1, forwarded_to_carrier_at = NOW\(\)/);
  });
});

describe("v373 — documents_text removed from carrier payload (Bug #23)", () => {
  it("no longer attaches documents_text to payload", () => {
    expect(submitSrc).not.toMatch(/payload[\s\S]*?\.documents_text\s*=/);
  });
  it("v373 marker comment present", () => {
    expect(submitSrc).toMatch(/BI_SERVER_BLOCK_v373/);
  });
});
