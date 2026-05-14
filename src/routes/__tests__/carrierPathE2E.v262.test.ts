// BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3
// String-shape assertions covering every code/schema fix in v262.
// No DB required.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readMigration = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");
const readRoute = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/routes", name), "utf8");
const readFile = (rel: string) =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("BI_SERVER_BLOCK_v262 — migration", () => {
  const sql = readMigration("2026_05_19_carrier_path_e2e_fix_v262.sql");
  it("adds lender_notes + company_name on bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lender_notes/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS company_name/i);
  });
  it("extends bi_document_type with 7 slot keys, one statement each", () => {
    for (const v of ["pl_12mo","forecast","gov_id_primary","gov_id_secondary","annual_y1","annual_y2","annual_y3"]) {
      const re = new RegExp(
        `ALTER\\s+TYPE\\s+bi_document_type\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}';`,
        "i"
      );
      expect(sql, `missing ADD VALUE for ${v}`).toMatch(re);
    }
  });
});

describe("BI_SERVER_BLOCK_v262 — server.ts duplicate mount removed", () => {
  const src = readFile("src/server.ts");
  it("biPublicApplicationRoutes is no longer mounted at /api/v1/bi", () => {
    // The duplicate mount line was the only place biPublicApplicationRoutes
    // appeared with the /api/v1/bi prefix. Should be gone.
    const dupRe = /app\.use\("\/api\/v1\/bi"[^)]*biPublicApplicationRoutes/;
    expect(src).not.toMatch(dupRe);
  });
  it("biPublicApplicationRoutes is still mounted at /api/v1 (public)", () => {
    // The primary mount must remain — that's how the BI-Website
    // applicant flow reaches the public endpoints.
    expect(src).toMatch(/app\.use\("\/api\/v1",[^)]*biPublicApplicationRoutes\)/);
  });
});

describe("BI_SERVER_BLOCK_v262 — biReferrerRoutes uses phone_e164", () => {
  const src = readRoute("biReferrerRoutes.ts");
  it("OTP verify uses phone_e164 everywhere", () => {
    const otp = src.match(/router\.post\("\/referrer\/otp\/verify".*?\}\);/s)?.[0];
    expect(otp).toBeTruthy();
    expect(otp!).toMatch(/bi_referrers WHERE phone_e164=/);
    expect(otp!).toMatch(/INSERT INTO bi_referrers \(phone_e164\)/);
    expect(otp!).not.toMatch(/bi_referrers WHERE phone=/);
  });
  it("dashboard aliases phone_e164 AS phone", () => {
    const dash = src.match(/router\.get\("\/referrer\/dashboard".*?\}\);/s)?.[0];
    expect(dash).toBeTruthy();
    expect(dash!).toMatch(/phone_e164\s+AS\s+phone/i);
  });
  it("POST /referrer/referrals uses phone_e164 + omits unsupported columns", () => {
    const refs = src.match(/router\.post\("\/referrer\/referrals".*?\}\);/s)?.[0];
    expect(refs).toBeTruthy();
    expect(refs!).toMatch(/INSERT INTO bi_referrals[^`]*phone_e164/);
    const contacts = refs!.match(/INSERT INTO bi_contacts[^`]+/)?.[0];
    expect(contacts).toBeTruthy();
    expect(contacts!).toMatch(/phone_e164/);
    expect(contacts!).not.toMatch(/company_name/);
    expect(contacts!).not.toMatch(/updated_at/);
  });
});

describe("BI_SERVER_BLOCK_v262 — biApplicationRoutes", () => {
  const src = readRoute("biApplicationRoutes.ts");

  it("GET /applications returns rich columns + filters + mapped stage", () => {
    for (const col of [
      "a.public_id","a.application_code","a.source","a.source_type",
      "a.is_demo","a.business_name","a.guarantor_name","a.lender_name",
      "a.loan_amount","a.pgi_limit","a.carrier_received_at",
      "a.carrier_last_event","a.pgi_application_id",
    ]) {
      expect(src, `missing ${col}`).toContain(col);
    }
    expect(src).toMatch(/req\.query\.hide_demo/);
    expect(src).toMatch(/req\.query\.lender_id/);
    expect(src).toMatch(/return ok\(res,\s*\{\s*applications:\s*result\.rows\s*\}\)/);
    expect(src).toMatch(/WHEN a\.status = 'created'\s+THEN 'new_application'/);
    expect(src).toMatch(/WHEN a\.status = 'document_review'\s+THEN 'document_review'/);
  });

  it("GET /applications/:id derives all_docs_accepted + maps stage + COALESCEs company_name", () => {
    expect(src).toMatch(/AS all_docs_accepted/);
    expect(src).toMatch(/AS effective_stage/);
    expect(src).toMatch(/stage:\s*row\.effective_stage/);
    expect(src).toMatch(
      /COALESCE\(a\.company_name,\s*co\.legal_name,\s*a\.business_name\)\s+AS company_name/
    );
  });

  it("GET /applications/:id/documents wraps in {documents} + enriches", () => {
    const docs = src.match(/router\.get\("\/applications\/:id\/documents".*?\}\);\s*\}\);/s)?.[0];
    expect(docs).toBeTruthy();
    expect(docs!).toMatch(/doc_type::text\s+AS doc_type/);
    expect(docs!).toMatch(/doc_slot/);
    expect(docs!).toMatch(/COALESCE\(review_status, 'pending'\) AS status/);
    expect(docs!).toMatch(/ocr_status::text\s+AS ocr_status/);
    expect(docs!).toMatch(/return ok\(res,\s*\{\s*documents\s*\}\)/);
  });

  it("PATCH stage is exposed at both /pipeline/:id/stage and /applications/:id/stage", () => {
    expect(src).toMatch(/router\.patch\("\/pipeline\/:id\/stage",\s*setStageHandler\)/);
    expect(src).toMatch(/router\.patch\("\/applications\/:id\/stage",\s*setStageHandler\)/);
  });
});

describe("BI_SERVER_BLOCK_v262 — biNotesRoutes returns {notes}", () => {
  const src = readRoute("biNotesRoutes.ts");
  it("GET / wraps in {notes}", () => {
    const h = src.match(/router\.get\("\/",\s*async[^]+?\}\);/)?.[0];
    expect(h).toBeTruthy();
    expect(h!).toMatch(/return ok\(res,\s*\{\s*ok:\s*true,\s*notes:/);
    expect(h!).not.toMatch(/items:\s*r\.rows/);
  });
});

describe("BI_SERVER_BLOCK_v262 — biLenderApplicationCreate", () => {
  const src = readRoute("biLenderApplicationCreate.ts");

  it("application INSERT writes source_type='lender'", () => {
    const insert = src.match(/INSERT INTO bi_applications[^`]+/)?.[0];
    expect(insert).toBeTruthy();
    expect(insert!).toMatch(/source_type/);
    expect(src).toMatch(/'applicant',\s*'new_application',\s*'lender',\s*'lender'/);
  });

  it("exposes POST /api/v1/lender/applications/:code/documents", () => {
    expect(src).toMatch(/router\.post\(\s*"\/api\/v1\/lender\/applications\/:code\/documents"/);
  });

  it("docs upload verifies lender ownership and writes bi_documents", () => {
    const docs = src.match(/router\.post\(\s*"\/api\/v1\/lender\/applications\/:code\/documents"[^]+?\}\)\s*;?\s*$/m)?.[0];
    expect(docs, "docs upload handler not found").toBeTruthy();
    expect(docs!).toMatch(/getLenderId\(req\)/);
    expect(docs!).toMatch(/INSERT INTO bi_documents/);
    expect(docs!).toMatch(/'lender'/);
    expect(docs!).toMatch(/store\.put/);
  });
});
