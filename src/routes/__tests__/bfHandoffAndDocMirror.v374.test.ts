// BI_BF_HANDOFF_LOAN_CAP_v374 / BI_DOC_MIRROR_SUPERSEDE_v374
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "src/db/migrations/2026_09_21_v374_drop_loan_amount_cap.sql"), "utf8");
const apps = readFileSync(join(root, "src/routes/biApplicationsFromBfRoutes.ts"), "utf8");
const docs = readFileSync(join(root, "src/routes/biDocumentsFromBfRoutes.ts"), "utf8");

describe("BF->BI handoff of large loans", () => {
  it("drops the loan-amount cap idempotently and keeps the guarantee cap", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS bi_applications_loan_amount_max_chk");
    expect(migration).not.toContain("pgi_limit_max_chk");
  });
  it("clamps the derived guarantee to the carrier maximum", () => {
    expect(apps).toContain("const PGI_LIMIT_MAX = 1_000_000;");
    expect(apps).toContain("Math.min(pgiLimitRaw, PGI_LIMIT_MAX)");
  });
});

describe("BF document mirror", () => {
  it("supersedes the older active document of the same type in one transaction", () => {
    const begin = docs.indexOf('client.query("BEGIN")');
    const purge = docs.indexOf("SET purged_at = NOW()");
    const insert = docs.indexOf("INSERT INTO bi_documents");
    expect(begin).toBeGreaterThan(-1);
    expect(purge).toBeGreaterThan(begin);
    expect(insert).toBeGreaterThan(purge);
    expect(docs).toContain("bf_document_id IS DISTINCT FROM $3");
    expect(docs).toContain('client.query("COMMIT")');
    expect(docs).toContain('client.query("ROLLBACK")');
    expect(docs).toContain("client.release()");
  });
  it("re-sending the same BF document revives it rather than duplicating", () => {
    expect(docs).toContain("purged_at = NULL,");
  });
});
