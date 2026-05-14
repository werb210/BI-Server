// BI_SERVER_BLOCK_v260_CARRIER_PATH_E2E_FIX_v1
// String-shape assertions covering the four code/schema fixes that
// unblock the public + lender carrier path end-to-end. No DB
// required — each test fails immediately if Codex's edit didn't land.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readMigration = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");
const readRoute = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/routes", name), "utf8");

describe("BI_SERVER_BLOCK_v260 — schema additions", () => {
  const sql = readMigration("2026_05_19_real_submission_fix_v260.sql");

  it("adds lender_notes column to bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lender_notes/i);
  });

  it("adds company_name column to bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS company_name/i);
  });

  it("extends bi_document_type with all 7 missing slot keys", () => {
    for (const v of [
      "pl_12mo",
      "forecast",
      "gov_id_primary",
      "gov_id_secondary",
      "annual_y1",
      "annual_y2",
      "annual_y3",
    ]) {
      // each ALTER TYPE ADD VALUE statement must be on its own line so
      // the v66 migration runner's extractor regex matches it
      const re = new RegExp(
        `ALTER\\s+TYPE\\s+bi_document_type\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}';`,
        "i"
      );
      expect(sql, `missing ADD VALUE for ${v}`).toMatch(re);
    }
  });
});

describe("BI_SERVER_BLOCK_v260 — biReferrerRoutes uses phone_e164", () => {
  const src = readRoute("biReferrerRoutes.ts");

  it("OTP verify SELECT/INSERT use phone_e164", () => {
    const otpVerify = src.match(/router\.post\("\/referrer\/otp\/verify"[\s\S]*?intake_complete: ref\.intake_complete \}\);/s)?.[0];
    expect(otpVerify).toBeTruthy();
    expect(otpVerify!).toMatch(/bi_referrers WHERE phone_e164=/);
    expect(otpVerify!).toMatch(/INSERT INTO bi_referrers \(phone_e164\)/);
    expect(otpVerify!).not.toMatch(/bi_referrers WHERE phone=/);
  });

  it("dashboard SELECT aliases phone_e164 AS phone", () => {
    const dashboard = src.match(/router\.get\("\/referrer\/dashboard".*?\}\);/s)?.[0];
    expect(dashboard).toBeTruthy();
    expect(dashboard!).toMatch(/phone_e164\s+AS\s+phone/i);
  });

  it("POST /referrer/referrals writes phone_e164 and omits unsupported columns", () => {
    const referrals = src.match(/router\.post\("\/referrer\/referrals"[\s\S]*?status: "invited" \}\);/s)?.[0];
    expect(referrals).toBeTruthy();
    expect(referrals!).toMatch(/INSERT INTO bi_referrals[^`]*phone_e164/);
    const contactsInsert = referrals!.match(/INSERT INTO bi_contacts[^`]+/)?.[0];
    expect(contactsInsert).toBeTruthy();
    expect(contactsInsert!).toMatch(/phone_e164/);
    expect(contactsInsert!).not.toMatch(/company_name/);
    expect(contactsInsert!).not.toMatch(/updated_at/);
  });
});

describe("BI_SERVER_BLOCK_v260 — biApplicationRoutes computes carrier-path fields", () => {
  const src = readRoute("biApplicationRoutes.ts");

  it("GET /applications/:id SELECTs all_docs_accepted (computed)", () => {
    expect(src).toMatch(/AS all_docs_accepted/);
    // boolean derived from bi_documents review_status
    expect(src).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM bi_documents/);
    expect(src).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM bi_documents/);
    expect(src).toMatch(/review_status, 'pending'\)\s*!=\s*'accepted'/);
  });

  it("GET /applications/:id SELECTs effective_stage derived from status", () => {
    expect(src).toMatch(/AS effective_stage/);
    expect(src).toMatch(/WHEN a\.status = 'document_review'\s+THEN 'document_review'/);
    expect(src).toMatch(/WHEN a\.status = 'submitted'\s+THEN 'submitted'/);
  });

  it("GET /applications/:id overrides stage with effective_stage in payload", () => {
    // The handler must spread the row then override stage = effective_stage
    expect(src).toMatch(/stage:\s*row\.effective_stage/);
  });

  it("GET /applications/:id COALESCEs company_name across three sources", () => {
    expect(src).toMatch(
      /COALESCE\(a\.company_name,\s*co\.legal_name,\s*a\.business_name\)\s+AS company_name/
    );
  });

  it("GET /applications/:id/documents enriches rows with review state", () => {
    // Must select doc_type, doc_slot, ocr_status, review_status aliased as status
    const docsHandler = src.match(/router\.get\("\/applications\/:id\/documents".*?return ok\(res,\s*\{\s*documents\s*\}\);\s*\}\);/s)?.[0];
    expect(docsHandler, "GET /applications/:id/documents handler not found in expected shape").toBeTruthy();
    expect(docsHandler!).toMatch(/doc_type::text\s+AS doc_type/);
    expect(docsHandler!).toMatch(/doc_slot/);
    expect(docsHandler!).toMatch(/COALESCE\(review_status, 'pending'\) AS status/);
    expect(docsHandler!).toMatch(/ocr_status::text\s+AS ocr_status/);
    // Response wrapped in {documents: [...]} (not a bare array) so the
    // portal's `r.documents` access works.
    expect(docsHandler!).toMatch(/return ok\(res,\s*\{\s*documents\s*\}\)/);
  });
});
