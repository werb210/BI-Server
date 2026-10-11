// BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3
// String-shape assertions covering every code/schema fix in v262.
// No DB required.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { vi } from "vitest";

const notesQueryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => notesQueryMock(...args) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import { requireAuth } from "../../platform/auth";
import biNotesRoutes from "../biNotesRoutes";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

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

// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep): the
// notes GET answers with a `notes` array (never `items`), staff only.
describe("BI_SERVER_BLOCK_v262 — biNotesRoutes returns {notes}", () => {
  it("GET answers { notes: [...] } (also under data), not items", async () => {
    notesQueryMock.mockImplementation(answerBySql([
      ["FROM bi_applications", { rows: [{ "?column?": 1 }] }],
      ["FROM bi_application_notes", { rows: [{ id: "n1", body: "hi", author_name: "Ann", created_at: "2026-01-01" }] }],
    ]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
    const token = jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string);
    const r = await request(app)
      .get("/api/v1/bi/applications/11111111-1111-4111-8111-111111111111/notes")
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.notes).toEqual([{ id: "n1", body: "hi", author_name: "Ann", created_at: "2026-01-01" }]);
    expect(r.body.data.notes).toEqual(r.body.notes);
    expect(r.body.items).toBeUndefined();
  });
});

describe("BI_SERVER_BLOCK_v262 — biLenderApplicationCreate", () => {
  const src = readRoute("biLenderApplicationCreate.ts");

  it("application INSERT writes source_type='lender'", () => {
    const insert = src.match(/INSERT INTO bi_applications[^`]+/)?.[0];
    expect(insert).toBeTruthy();
    expect(insert!).toMatch(/source_type/);
    expect(src).toMatch(/VALUES \('applicant',\s*'lender',\s*'lender'/); // BI_UNQUARANTINE_CARRIER_E2E_v1 - status is no longer inserted
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
