// BI_CLIENT_CONTRACT_ROUTES_v21 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const routes = read("src/routes/biApplicantContractRoutes.ts");
const server = read("src/server.ts");

describe("the three endpoints bi-client already calls now exist", () => {
  it("mounts contract upload", () => expect(routes).toContain('router.post("/applicants/contract/upload"'));
  it("mounts the requirements list", () => {
    expect(routes).toContain('router.get("/applicants/applications/:id/requirements"');
  });
  it("mounts requirement confirm", () => {
    expect(routes).toContain('"/applicants/applications/:id/requirements/:reqId/confirm"');
  });
  it("is mounted under /api/v1 with the BI cors guard", () => {
    expect(server).toContain('app.use("/api/v1", biCors, biApplicantContractRoutes);');
  });
});

describe("the orphaned extractor is finally wired", () => {
  it("upload runs OCR then extraction", () => {
    expect(routes).toContain('from "../services/ocrService"');
    expect(routes).toContain('from "../services/contractRequirements"');
    expect(routes).toContain("extractRequirements(ocr.extractedText)");
  });
  it("a failed OCR still stores the contract rather than failing the upload", () => {
    expect(routes).toContain('ocr.status === "complete"');
    expect(routes).toContain("ocrStatus: ocr.status");
  });
});

describe("every route is applicant-authenticated and ownership-checked", () => {
  it("uses the shared guard, not a second copy", () => {
    expect(routes).toContain('from "./applicantAuth"');
    expect((routes.match(/authApplicant/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it("checks the caller owns the application as applicant or guarantor", () => {
    expect(routes).toContain("applicant_phone_e164, guarantor_phone");
    expect(routes).toContain('"not_owner"');
  });
});

describe("confirming a requirement selects the product", () => {
  it("inserts into bi_application_products with source 'contract'", () => {
    expect(routes).toContain("INSERT INTO bi_application_products");
    expect(routes).toContain("'contract'");
  });
  it("un-confirming only withdraws contract-sourced lines", () => {
    expect(routes).toContain("ap.source = 'contract'");
  });
});

describe("PGI leads the coverage list", () => {
  it("the migration pulls pgi to the top for both countries", () => {
    const migration = read("src/db/migrations/20260809_bi_client_pgi_first.sql");
    expect(migration).toMatch(/UPDATE bi_products SET sort_order = 5/);
    expect(migration).toContain("code = 'pgi'");
    expect(migration).toContain("sort_order <> 5");
  });
  it("the product list is ordered by that column, so ordering stays data", () => {
    expect(routes).toContain("ORDER BY sort_order ASC");
    expect(routes).toContain("industry = 'construction'");
  });
  it("serves both countries", () => {
    expect(routes).toContain('COUNTRIES = new Set(["CA", "US"])');
  });
});
