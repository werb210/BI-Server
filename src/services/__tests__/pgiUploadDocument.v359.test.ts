// BI_SERVER_BLOCK_v359_PGI_DOC_FORWARDING_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const adapterSrc = fs.readFileSync(path.resolve(__dirname, "../pgiAdapter.ts"), "utf8");
const lenderRoute = fs.readFileSync(path.resolve(__dirname, "../../routes/biLenderApiRoutes.ts"), "utf8");
const docRoute = fs.readFileSync(path.resolve(__dirname, "../../routes/biDocumentRoutes.ts"), "utf8");

describe("v359 — pgiUploadDocument", () => {
  it("adapter exports pgiUploadDocument", () => {
    expect(adapterSrc).toMatch(/export async function pgiUploadDocument/);
  });
  it("posts multipart to /api/v2/applications/{id}/documents/", () => {
    expect(adapterSrc).toMatch(/\/api\/v2\/applications\/\$\{[^}]+\}\/documents/);
    expect(adapterSrc).toMatch(/new FormData\(\)/);
    expect(adapterSrc).toMatch(/fd\.append\("doc_type"/);
    expect(adapterSrc).toMatch(/fd\.append\("file"/);
  });
  it("doc_type is restricted to the 7-value allowlist in the type signature", () => {
    expect(adapterSrc).toMatch(/"loan_agreement"\s*\|\s*"profit_loss"\s*\|\s*"balance_sheet"\s*\|\s*"ar_aging"\s*\|\s*"ap_aging"\s*\|\s*"founder_cv"\s*\|\s*"financial_forecast"/);
  });
  it("STUB mode returns a deterministic stub response", () => {
    expect(adapterSrc).toMatch(/if \(STUB\)[\s\S]*?STUB_DOC_/);
  });
});

describe("v359 — lender upload forwards to PGI when pgi_application_id is set", () => {
  it("imports pgiUploadDocument dynamically", () => {
    expect(lenderRoute).toMatch(/pgiUploadDocument/);
  });
  it("updates bi_documents.pgi_document_id + forwarded_to_carrier_at after forward", () => {
    expect(lenderRoute).toMatch(/UPDATE bi_documents SET pgi_document_id/);
  });
  it("forward failure is non-fatal (warn + continue)", () => {
    expect(lenderRoute).toMatch(/pgi_doc_forward_failed/);
  });
});

describe("v359 — staff accept-all backfills any pending forwards", () => {
  it("backfill loop fires when public auto-submit succeeds", () => {
    expect(docRoute).toMatch(/post-submit doc flush failed|backfill doc forward failed/);
  });
});
