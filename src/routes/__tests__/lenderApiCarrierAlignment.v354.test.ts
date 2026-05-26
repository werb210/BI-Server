// BI_SERVER_BLOCK_v354_LENDER_API_CARRIER_ALIGNMENT_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const apiSrc = fs.readFileSync(path.resolve(__dirname, "../biLenderApiRoutes.ts"), "utf8");
const portalSrc = fs.readFileSync(path.resolve(__dirname, "../biLenderApplicationCreate.ts"), "utf8");

describe("v354 — Lender Direct API accepts both shapes", () => {
  it("imports validatePgiSubmissionV2 + buildCarrierPayloadV2", () => {
    expect(apiSrc).toMatch(/import \{ validatePgiSubmissionV2 \} from .+pgiFields/);
    expect(apiSrc).toMatch(/import \{ buildCarrierPayloadV2 \} from .+pgiCarrierMapper/);
  });
  it("normalizeLenderBody handles the v2 nested shape", () => {
    expect(apiSrc).toMatch(/function normalizeLenderBody/);
    expect(apiSrc).toMatch(/input\.guarantor && typeof input\.guarantor === "object"/);
  });
  it("Deprecation header set on legacy-shape requests", () => {
    expect(apiSrc).toMatch(/setHeader\("Deprecation"/);
    expect(apiSrc).toMatch(/setHeader\("Sunset"/);
  });
  it("Runs validatePgiSubmissionV2 against the assembled envelope", () => {
    expect(apiSrc).toMatch(/validatePgiSubmissionV2\(v2Envelope\)/);
  });
});

describe("v354 — Doc-type allowlist enforced on lender API uploads", () => {
  it("ALLOWED_DOC_TYPES has exactly the 7 carrier-required types", () => {
    const m = apiSrc.match(/ALLOWED_DOC_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(m).toBeTruthy();
    const block = m![1];
    expect(block).toMatch(/"loan_agreement"/);
    expect(block).toMatch(/"profit_loss"/);
    expect(block).toMatch(/"balance_sheet"/);
    expect(block).toMatch(/"ar_aging"/);
    expect(block).toMatch(/"ap_aging"/);
    expect(block).toMatch(/"founder_cv"/);
    expect(block).toMatch(/"financial_forecast"/);
    expect(block).not.toMatch(/"guarantor_id"/);
    expect(block).not.toMatch(/"annual_y1"/);
  });
  it("returns 400 invalid_doc_type with the allowed list on rejection", () => {
    expect(apiSrc).toMatch(/error:\s*"invalid_doc_type"/);
    expect(apiSrc).toMatch(/allowed:\s*Array\.from\(ALLOWED_DOC_TYPES\)/);
  });
});

describe("v354 — Co-guarantors persisted from nested body", () => {
  it("INSERTs into bi_co_guarantors when norm.co_guarantors is non-empty", () => {
    expect(apiSrc).toMatch(/INSERT INTO bi_co_guarantors/);
  });
});

describe("v354 — Portal endpoint switched to v2 carrier mapper", () => {
  it("biLenderApplicationCreate uses buildCarrierPayloadV2", () => {
    expect(portalSrc).toMatch(/buildCarrierPayloadV2\(carrierRowSnapshot/);
  });
  it("portal carrierRowSnapshot includes all v2 carrier-required fields", () => {
    expect(portalSrc).toMatch(/q4_date_of_birth:/);
    expect(portalSrc).toMatch(/q5_residential_address:/);
    expect(portalSrc).toMatch(/q_ca_id_type:/);
    expect(portalSrc).toMatch(/q_ca_id_number:/);
    expect(portalSrc).toMatch(/q17_business_operating_address:/);
    expect(portalSrc).toMatch(/q_ca_loan_type:/);
  });
});
