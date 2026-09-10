// BI_SERVER_PGI_MIRROR_VOCAB_v1
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const routeSource = readFileSync("src/routes/biDocumentsFromBfRoutes.ts", "utf8");
const completionSource = readFileSync("src/services/pgiCompletion.ts", "utf8");
const migration = readFileSync("src/db/migrations/2026_09_10_pgi_catalog_required_flag_v1.sql", "utf8");
const ACTIVE_CATALOG = ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"];
describe("BI_SERVER_PGI_MIRROR_VOCAB_v1", () => {
  it("maps every active catalog doc_type to itself", () => { for (const t of ACTIVE_CATALOG) expect(routeSource).toContain(`${t}: "${t}"`); });
  it("no longer resolves loan_agreement to the deactivated loan_agreement_signed", () => expect(routeSource).not.toContain('loan_agreement: "loan_agreement_signed"'));
  it("preserves BF's own category in document_type_legacy", () => {
    expect(routeSource).toContain("const bfCategoryRaw = s(b.bf_document_type) ?? bfDocumentTypeRaw;");
    expect(routeSource).toContain("docTypeText, bfCategoryRaw,");
  });
});
describe("BI_PGI_REQUIRED_FLAG_v1", () => {
  it("gates completion on required rows only", () => expect(completionSource).toContain("COALESCE(c.required, TRUE) = TRUE"));
  it("adds the column idempotently and marks the six optional rows", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT TRUE");
    expect(migration).toContain("'profit_loss','balance_sheet','ar_aging','ap_aging','founder_cv','financial_forecast'");
    expect(migration).toContain("WHERE doc_type = 'loan_agreement'");
  });
});
