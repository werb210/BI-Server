// BI_SERVER_BLOCK_v357_CONSENT_DERIVATION_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biPublicApplicationRoutes.ts"), "utf8");

describe("v357 — submit derives missing consents from declarations", () => {
  it("info_accurate derived from section_3_c === Agree", () => {
    expect(src).toMatch(/c\.info_accurate\s*=\s*decls\.section_3_c\s*===\s*"Agree"/);
  });
  it("business_solvent derived from section_6_a === yes", () => {
    expect(src).toMatch(/c\.business_solvent\s*=\s*decls\.section_6_a\s*===\s*"yes"/);
  });
  it("derived consents persisted back to the row", () => {
    expect(src).toMatch(/UPDATE bi_applications SET consents = \$1::jsonb/);
  });
  it("the 7-key requirement is still enforced", () => {
    const block = src.match(/const consentKeys = \[([\s\S]*?)\]/);
    expect(block).toBeTruthy();
    for (const k of ["electronic_signature","info_accurate","business_solvent","no_undisclosed_events","data_use","credit_pull","coverage_understood"]) {
      expect(block![1]).toContain(`"${k}"`);
    }
  });
});
