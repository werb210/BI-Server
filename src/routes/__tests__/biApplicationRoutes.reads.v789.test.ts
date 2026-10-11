// BI_SERVER_v789 [5]/[37] - behaviour tests for the staff read endpoints of
// biApplicationRoutes. They replace the source-text checks that lived in
// carrierPathE2E.v260/v261/v262, biApplicationRoutes.v386 and
// biDocumentClassifier.v276 (wiring): each intent is now checked against the
// router with the database mocked by SQL content.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import router from "../biApplicationRoutes";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const APP = "44444444-4444-4444-8444-444444444444";
const LENDER = "55555555-5555-4555-8555-555555555555";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as any).user = { role: "staff", staffUserId: null }; next(); });
  a.use("/api/v1/bi", router);
  return a;
}
const flat = (s: unknown) => sqlText(s).replace(/\s+/g, " ");

beforeEach(() => {
  poolQuery.mockReset().mockImplementation(answerBySql([], { rows: [], rowCount: 0 }));
});

describe("GET /applications (pipeline listing)", () => {
  it("selects the rich columns, applies hide_demo + lender_id, wraps in {applications}", async () => {
    poolQuery.mockImplementation(answerBySql([["FROM bi_applications a", { rows: [{ id: APP, stage: "document_review" }] }]]));
    const r = await request(app()).get(`/api/v1/bi/applications?hide_demo=true&lender_id=${LENDER}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ applications: [{ id: APP, stage: "document_review" }] });
    const [sql, params] = callsMatching(poolQuery, "FROM bi_applications a")[0]!;
    for (const col of ["a.public_id", "a.application_code", "a.source", "a.source_type", "a.is_demo", "a.business_name",
      "a.guarantor_name", "a.lender_name", "a.loan_amount", "a.pgi_limit", "a.carrier_received_at", "a.carrier_last_event", "a.pgi_application_id"]) {
      expect(flat(sql)).toContain(col);
    }
    expect(params).toEqual([true, LENDER]);
  });

  it("rejects a malformed lender_id before it reaches the uuid cast", async () => {
    const r = await request(app()).get("/api/v1/bi/applications?lender_id=nope");
    expect(r.status).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("maps status to the portal stage: created -> new_application, document_review -> document_review (v386)", async () => {
    await request(app()).get("/api/v1/bi/applications");
    const sql = flat(callsMatching(poolQuery, "FROM bi_applications a")[0]![0]);
    expect(sql).toContain("WHEN a.status = 'created' THEN 'new_application'");
    expect(sql).toContain("WHEN a.status = 'document_review' THEN 'document_review'");
    expect(sql).not.toContain("WHEN a.status = 'document_review' THEN 'under_review'");
  });
});

describe("GET /applications/:id (detail)", () => {
  it("derives all_docs_accepted + effective_stage, COALESCEs company_name, and overrides stage", async () => {
    poolQuery.mockImplementation(answerBySql([
      ["FROM bi_applications a", { rows: [{ id: APP, stage: "documents_pending", effective_stage: "document_review", pgi_status: "documents_pending", all_docs_accepted: true, company_name: "Acme" }] }],
    ]));
    const r = await request(app()).get(`/api/v1/bi/applications/${APP}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: APP, stage: "document_review", pgiStatus: "documents_pending", all_docs_accepted: true, company_name: "Acme" });
    expect(r.body.data.effective_stage).toBeUndefined();
    const sql = flat(callsMatching(poolQuery, "FROM bi_applications a")[0]![0]);
    expect(sql).toContain("AS all_docs_accepted");
    expect(sql).toMatch(/EXISTS \( SELECT 1 FROM bi_documents/);
    expect(sql).toMatch(/NOT EXISTS \( SELECT 1 FROM bi_documents/);
    expect(sql).toContain("COALESCE(review_status, 'pending') NOT IN ('accepted', 'rejected')");
    expect(sql).toContain("WHEN a.status = 'document_review' THEN 'document_review'");
    expect(sql).toContain("AS effective_stage");
    expect(sql).toContain("COALESCE(a.company_name, co.legal_name, a.business_name) AS company_name");
  });

  it("400s when the application does not exist", async () => {
    const r = await request(app()).get(`/api/v1/bi/applications/${APP}`);
    expect(r.status).toBe(400);
  });
});

describe("GET /applications/:id/documents", () => {
  it("enriches rows with review state, slot, OCR status and the misfiled flag, wrapped in {documents}", async () => {
    poolQuery.mockImplementation(answerBySql([
      ["FROM bi_documents", { rows: [{
        id: "d1", original_filename: "a.pdf", created_at: "2026-01-01", doc_type: "loan_agreement", doc_slot: "loan_agreement",
        period_end: null, status: "pending", ocr_status: "complete", detected_type: "balance_sheet", detected_confidence: "0.80", detected_mismatch: true, unclassified_text: null,
      }] }],
    ]));
    const r = await request(app()).get(`/api/v1/bi/applications/${APP}/documents`);
    expect(r.status).toBe(200);
    expect(r.body.data.documents).toHaveLength(1);
    expect(r.body.data.documents[0]).toMatchObject({
      id: "d1", file_name: "a.pdf", doc_type: "loan_agreement", doc_slot: "loan_agreement", status: "pending",
      ocr_status: "complete", detected_confidence: 0.8, looks_misfiled: true,
    });
    const sql = flat(callsMatching(poolQuery, "FROM bi_documents")[0]![0]);
    expect(sql).toContain("doc_type::text AS doc_type");
    expect(sql).toContain("COALESCE(review_status, 'pending') AS status");
    expect(sql).toContain("ocr_status::text AS ocr_status");
    expect(sql).toContain("purged_at IS NULL");
  });
});

describe("PATCH stage", () => {
  it.each(["/api/v1/bi/pipeline", "/api/v1/bi/applications"])("is exposed at %s/:id/stage", async (base) => {
    const r = await request(app()).patch(`${base}/${APP}/stage`).send({ stage: "under_review" });
    expect(r.status).toBe(200);
    const upd = callsMatching(poolQuery, "UPDATE bi_applications SET stage=$2");
    expect(upd).toHaveLength(1);
    expect(upd[0]![1]).toEqual([APP, "under_review"]);
  });
});
