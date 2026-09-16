// BI_SERVER_DOC_CLASSIFICATION_v276
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyBiDocument, labelForDetectedType } from "../services/biDocumentClassifier";

const LOAN = "LOAN AGREEMENT between ABC Bank (the Lender) and Voss Events Inc (the Borrower). Principal amount $250,000. Interest rate prime + 2%.";
const GUARANTEE = "PERSONAL GUARANTEE. The undersigned Guarantor hereby unconditionally guarantees the Guaranteed Obligations of the Borrower.";
const BALANCE = "Voss Events Inc Balance Sheet as at April 30 2026. Total assets 812,000. Total liabilities 402,000. Retained earnings 210,000.";

describe("classifying BI documents", () => {
  it("recognises a loan agreement in its own slot", () => {
    expect(classifyBiDocument(LOAN, "loan_agreement_signed")).toMatchObject({ detectedType: "loan_agreement", mismatch: false });
  });
  it("flags a personal guarantee uploaded as the loan agreement", () => {
    const c = classifyBiDocument(GUARANTEE, "loan_agreement_signed");
    expect(c).toMatchObject({ detectedType: "personal_guarantee", label: "a personal guarantee", mismatch: true });
    expect(c.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it("accepts a balance sheet in a financial statements slot", () => {
    expect(classifyBiDocument(BALANCE, "annual_y1").mismatch).toBe(false);
    expect(classifyBiDocument(BALANCE, "financial_statements").mismatch).toBe(false);
  });
  it("stays quiet on thin text, one weak signal, or the Other slot", () => {
    expect(classifyBiDocument("scan", "loan_agreement").detectedType).toBeNull();
    expect(classifyBiDocument("This page mentions a lender once and nothing else of note at all here.", "founder_cv").detectedType).toBeNull();
    expect(classifyBiDocument(GUARANTEE, "other").mismatch).toBe(false);
  });
  it("labels detected types", () => {
    expect(labelForDetectedType("ar_aging")).toBe("an A/R aging report");
    expect(labelForDetectedType(null)).toBeNull();
  });
});

describe("wiring", () => {
  it("classifies after OCR and returns the result to the portal", () => {
    expect(readFileSync("src/services/ocrRunner.ts", "utf-8")).toContain("classifyBiDocument(result.extractedText");
    const routes = readFileSync("src/routes/biApplicationRoutes.ts", "utf-8");
    expect(routes).toContain("looks_misfiled: row.detected_mismatch === true");
    expect(readFileSync("src/db/migrations/2026_09_16_v276_bi_document_classification.sql", "utf-8")).toContain("ADD COLUMN IF NOT EXISTS detected_mismatch");
  });
});
