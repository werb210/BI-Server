// BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2
// String-shape assertions covering every code/schema fix in v261.
// No DB required.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readMigration = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");
const readRoute = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/routes", name), "utf8");

describe("BI_SERVER_BLOCK_v261 — migration", () => {
  const sql = readMigration("2026_05_19_carrier_path_e2e_fix_v261.sql");

  it("adds lender_notes + company_name on bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lender_notes/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS company_name/i);
  });

  it("extends bi_document_type with all 7 missing slot keys, each on its own line", () => {
    for (const v of [
      "pl_12mo",
      "forecast",
      "gov_id_primary",
      "gov_id_secondary",
      "annual_y1",
      "annual_y2",
      "annual_y3",
    ]) {
      const re = new RegExp(
        `ALTER\\s+TYPE\\s+bi_document_type\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}';`,
        "i"
      );
      expect(sql, `missing ADD VALUE for ${v}`).toMatch(re);
    }
  });
});

describe("BI_SERVER_BLOCK_v261 — biReferrerRoutes uses phone_e164", () => {
  const src = readRoute("biReferrerRoutes.ts");

  it("OTP verify uses phone_e164 everywhere", () => {
    const otpVerify = src.match(/router\.post\("\/referrer\/otp\/verify".*?\}\);/s)?.[0];
    expect(otpVerify).toBeTruthy();
    expect(otpVerify!).toMatch(/bi_referrers WHERE phone_e164=/);
    expect(otpVerify!).toMatch(/INSERT INTO bi_referrers \(phone_e164\)/);
    expect(otpVerify!).not.toMatch(/bi_referrers WHERE phone=/);
  });

  it("dashboard aliases phone_e164 AS phone", () => {
    const dashboard = src.match(/router\.get\("\/referrer\/dashboard".*?\}\);/s)?.[0];
    expect(dashboard).toBeTruthy();
    expect(dashboard!).toMatch(/phone_e164\s+AS\s+phone/i);
  });

  it("POST /referrer/referrals writes phone_e164 and omits unsupported columns", () => {
    const referrals = src.match(/router\.post\("\/referrer\/referrals".*?\}\);/s)?.[0];
    expect(referrals).toBeTruthy();
    expect(referrals!).toMatch(/INSERT INTO bi_referrals[^`]*phone_e164/);
    const contactsInsert = referrals!.match(/INSERT INTO bi_contacts[^`]+/)?.[0];
    expect(contactsInsert).toBeTruthy();
    expect(contactsInsert!).toMatch(/phone_e164/);
    expect(contactsInsert!).not.toMatch(/company_name/);
    expect(contactsInsert!).not.toMatch(/updated_at/);
  });
});

describe("BI_SERVER_BLOCK_v261 — biApplicationRoutes", () => {
  const src = readRoute("biApplicationRoutes.ts");

  it("GET /applications listing returns rich columns + supports hide_demo/lender_id", () => {
    // 15+ columns the portal renders
    for (const col of [
      "a.public_id",
      "a.application_code",
      "a.source",
      "a.source_type",
      "a.is_demo",
      "a.business_name",
      "a.guarantor_name",
      "a.lender_name",
      "a.loan_amount",
      "a.pgi_limit",
      "a.carrier_received_at",
      "a.carrier_last_event",
      "a.pgi_application_id",
    ]) {
      expect(src, `missing column ${col} in listing`).toContain(col);
    }
    // filter params
    expect(src).toMatch(/req\.query\.hide_demo/);
    expect(src).toMatch(/req\.query\.lender_id/);
    // wrap shape
    expect(src).toMatch(/return ok\(res,\s*\{\s*applications:\s*result\.rows\s*\}\)/);
  });

  it("GET /applications/:id derives all_docs_accepted + effective_stage via passthrough", () => {
    expect(src).toMatch(/AS all_docs_accepted/);
    expect(src).toMatch(/COALESCE\(a\.status,\s*a\.stage::text\)\s+AS effective_stage/);
    expect(src).toMatch(/stage:\s*row\.effective_stage/);
    expect(src).toMatch(
      /COALESCE\(a\.company_name,\s*co\.legal_name,\s*a\.business_name\)\s+AS company_name/
    );
  });

  it("GET /applications/:id/documents enriches rows and wraps in {documents}", () => {
    const docsHandler = src.match(/router\.get\("\/applications\/:id\/documents".*?\}\);\s*\}\);/s)?.[0];
    expect(docsHandler, "documents handler not found").toBeTruthy();
    expect(docsHandler!).toMatch(/doc_type::text\s+AS doc_type/);
    expect(docsHandler!).toMatch(/doc_slot/);
    expect(docsHandler!).toMatch(/COALESCE\(review_status, 'pending'\) AS status/);
    expect(docsHandler!).toMatch(/ocr_status::text\s+AS ocr_status/);
    expect(docsHandler!).toMatch(/return ok\(res,\s*\{\s*documents\s*\}\)/);
  });

  it("PATCH stage path is exposed at both /pipeline/:id/stage and /applications/:id/stage", () => {
    expect(src).toMatch(/router\.patch\("\/pipeline\/:id\/stage",\s*setStageHandler\)/);
    expect(src).toMatch(/router\.patch\("\/applications\/:id\/stage",\s*setStageHandler\)/);
  });
});

describe("BI_SERVER_BLOCK_v261 — biNotesRoutes returns {notes}", () => {
  const src = readRoute("biNotesRoutes.ts");
  it("GET wraps in {notes: [...]} not {items: [...]}", () => {
    // Match the GET / handler body
    const getHandler = src.match(/router\.get\("\/",\s*async[^]+?\}\);/)?.[0];
    expect(getHandler, "GET / handler not found").toBeTruthy();
    expect(getHandler!).toMatch(/return ok\(res,\s*\{\s*ok:\s*true,\s*notes:/);
    expect(getHandler!).not.toMatch(/items:\s*r\.rows/);
  });
});

describe("BI_SERVER_BLOCK_v261 — biLenderApplicationCreate sets source_type='lender'", () => {
  const src = readRoute("biLenderApplicationCreate.ts");
  it("INSERT writes source_type='lender'", () => {
    // The INSERT must include source_type in the column list and a
    // matching 'lender' literal in the VALUES.
    const insert = src.match(/INSERT INTO bi_applications[^`]+/)?.[0];
    expect(insert, "INSERT not found").toBeTruthy();
    expect(insert!).toMatch(/source_type/);
    expect(src).toMatch(/'applicant',\s*'new_application',\s*'lender',\s*'lender'/);
  });
});
