// BI_SERVER_v789_DOC_FLUSH / NO_ERR_MESSAGE / CARRIER_EVENTS / STAGE_ENUM
// Document accept (both handlers) auto-submits public apps and flushes the
// accepted documents through the shared forwardAcceptedDocsToCarrier (which
// orders by bi_documents.created_at; the old inline copies ordered by the
// non-existent uploaded_at and always failed). Failures answer with a code,
// never the carrier text, and write carrier_submission_failed exactly once.
// The staff submit failure path reverts to a real bi_pipeline_stage value.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
const logs = vi.hoisted(() => ({ error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("../../platform/logger", () => ({
  logger: {
    error: (...a: unknown[]) => { logs.error.push(a); },
    warn: (...a: unknown[]) => { logs.warn.push(a); },
    info: () => undefined,
  },
}));
vi.mock("../../platform/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { role: req.header("x-test-role") ?? "staff", staffUserId: null }; next(); },
}));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn(async () => undefined) }));
vi.mock("../../services/ocrService", () => ({ extractText: vi.fn() }));
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn(async () => ({ channel: "push" })) }));
const pgiSubmitV2 = vi.fn();
const pgiUploadDocument = vi.fn();
vi.mock("../../services/pgiAdapter", async () => {
  const actual = await vi.importActual<typeof import("../../services/pgiAdapter")>("../../services/pgiAdapter");
  return { ...actual, pgiSubmitV2: (...a: unknown[]) => pgiSubmitV2(...a), pgiUploadDocument: (...a: unknown[]) => pgiUploadDocument(...a) };
});
vi.mock("../../services/pgiCarrierMapper", () => ({ buildCarrierPayloadV2: () => ({ p: 1 }), buildCarrierPayloadFromRow: vi.fn() }));
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ get: async () => ({ buffer: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }) }),
}));

import biDocumentRoutes from "../biDocumentRoutes";
import biApplicationDetailRoutes from "../biApplicationDetailRoutes";
import biApplicationRoutes from "../biApplicationRoutes";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const APP = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

function db() {
  return answerBySql([
    // accept handlers
    [/SELECT application_id, doc_type FROM bi_documents WHERE id=\$1/, { rows: [{ application_id: APP, doc_type: "loan_agreement" }] }],
    [/SELECT d\.application_id, d\.doc_type, a\.source_type/, { rows: [{ application_id: APP, doc_type: "loan_agreement", source_type: "public" }], rowCount: 1 }],
    [/COUNT\(\*\) FILTER/, { rows: [{ pending: "0", accepted: "2", total: "2" }] }],
    [/SELECT source_type, status FROM bi_applications/, { rows: [{ source_type: "public", status: "document_review" }] }],
    [/SET status = 'ready_for_submission'/, { rows: [{ id: APP }], rowCount: 1 }],
    // submitApplicationToPGI
    [/SET submission_locked = TRUE/, { rows: [{ id: APP }], rowCount: 1 }],
    [/FROM bi_applications a\s+LEFT JOIN bi_companies/, { rows: [{ id: APP, guarantor_name: "G", guarantor_email: "g@x.test", lender_name: null, company_name: "Acme" }] }],
    // forwardAcceptedDocsToCarrier
    [/review_status = 'accepted'\s+AND pgi_document_id IS NULL/, { rows: [
      { id: "d1", doc_type: "loan_agreement", original_filename: "la.pdf", mime_type: "application/pdf", storage_key: "k1", blob_name: "k1", bf_document_id: null },
      { id: "d2", doc_type: "balance_sheet", original_filename: "bs.pdf", mime_type: "application/pdf", storage_key: null, blob_name: "k2", bf_document_id: null },
    ] }],
    // staff submit-to-carrier
    [/SELECT source_type, stage, status, submission_locked/, { rows: [{ source_type: "public", stage: "documents_pending", status: "document_review", submission_locked: false }] }],
    ["AS slot, review_status AS status", { rows: ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging"].map((slot) => ({ slot, status: "accepted" })) }],
    ["INSERT INTO bi_submission_logs", { rows: [{ id: "log-1" }] }],
  ], { rows: [], rowCount: 1 });
}

function docApp() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi/documents", biDocumentRoutes);
  return a;
}
function detailApp() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as any).user = { role: "staff", staffUserId: null }; next(); });
  a.use("/api/v1/bi/applications", biApplicationDetailRoutes);
  return a;
}
function staffApp(role = "admin") {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as any).user = { role, staffUserId: null }; next(); });
  a.use("/api/v1/bi", biApplicationRoutes);
  return a;
}

beforeEach(() => {
  poolQuery.mockReset().mockImplementation(db());
  pgiSubmitV2.mockReset().mockResolvedValue({ application_id: "PGI-1", status: "received" });
  pgiUploadDocument.mockReset().mockImplementation(async (a: { docType: string }) => ({ document_id: `DOC-${a.docType}`, doc_type: a.docType, received_at: "now" }));
  logs.error.length = 0;
  logs.warn.length = 0;
});

function noUploadedAt() {
  for (const c of poolQuery.mock.calls) expect(sqlText(c[0])).not.toContain("uploaded_at");
}

describe.each([
  ["biDocumentRoutes POST /documents/:id/accept", () => request(docApp()).post(`/api/v1/bi/documents/${DOC}/accept`).send({})],
  ["biApplicationDetailRoutes POST /applications/:id/documents/:docId/accept", () => request(detailApp()).post(`/api/v1/bi/applications/${APP}/documents/${DOC}/accept`).send({})],
])("%s (v789)", (_name, call) => {
  it("auto-submits and forwards the accepted documents through the shared flush (ordered by created_at)", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const body = r.body.data ?? r.body;
    expect(body.autoSubmittedToPgi).toBe(true);
    expect(body.pgiSubmitError).toBeNull();
    expect(pgiUploadDocument).toHaveBeenCalledTimes(2);
    expect(pgiUploadDocument.mock.calls.map((c) => (c[0] as { pgiApplicationId: string }).pgiApplicationId)).toEqual(["PGI-1", "PGI-1"]);
    const flush = callsMatching(poolQuery, /review_status = 'accepted'\s+AND pgi_document_id IS NULL/);
    expect(flush).toHaveLength(1);
    expect(sqlText(flush[0]![0])).toMatch(/ORDER BY created_at/);
    expect(callsMatching(poolQuery, /SET pgi_document_id = \$1/)).toHaveLength(2);
    noUploadedAt();
  });

  it("a carrier failure answers with a code (no carrier text) and records carrier_submission_failed once", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("pgi_submit_failed status=500 body=<html>SECRET upstream</html>"));
    const r = await call();
    expect(r.status).toBe(200);
    const body = r.body.data ?? r.body;
    expect(body.autoSubmittedToPgi).toBe(false);
    expect(body.pgiSubmitError).toBe("PGI_SUBMIT_FAILED");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    const ev = callsMatching(poolQuery, "INSERT INTO bi_events");
    expect(ev).toHaveLength(1);
    expect(sqlText(ev[0]![0])).toContain("'carrier_submission_failed'");
    const activity = callsMatching(poolQuery, "'auto_submit_to_pgi_failed'");
    expect(JSON.stringify(activity[0]![1])).not.toContain("SECRET");
    expect(pgiUploadDocument).not.toHaveBeenCalled();
  });
});

describe("staff submit-to-carrier failure path (v789)", () => {
  it("reverts to a real bi_pipeline_stage value, keeps status document_review, answers with a code", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("carrier exploded: SECRET"));
    const r = await request(staffApp()).post(`/api/v1/bi/applications/${APP}/submit-to-carrier`).send({});
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("SUBMIT_FAILED");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    const revert = callsMatching(poolQuery, /SET submission_locked = FALSE,\s+stage = /);
    expect(revert).toHaveLength(1);
    const sql = sqlText(revert[0]![0]);
    expect(sql).toContain("stage = 'documents_pending'");
    expect(sql).toContain("status = 'document_review'");
    expect(sql).not.toContain("stage = 'document_review'");
    expect(callsMatching(poolQuery, "'carrier_submission_failed'")).toHaveLength(1);
  });

  it("logs (does not swallow) a failure to release the lock", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("down"));
    poolQuery.mockImplementation(answerBySql([
      [/SET submission_locked = FALSE,\s+stage = /, () => { throw new Error("invalid input value for enum bi_pipeline_stage"); }],
    ], db()));
    const r = await request(staffApp()).post(`/api/v1/bi/applications/${APP}/submit-to-carrier`).send({});
    expect(r.status).toBe(500);
    expect(logs.error.some((a) => a[1] === "submit_to_carrier_lock_release_failed")).toBe(true);
  });

  it("non-admin is refused", async () => {
    const r = await request(staffApp("staff")).post(`/api/v1/bi/applications/${APP}/submit-to-carrier`).send({});
    expect(r.status).toBe(403);
  });

  it("POST /application/:id/submit-pgi answers a code, never the error text", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("SECRET carrier body"));
    const r = await request(staffApp()).post(`/api/v1/bi/application/${APP}/submit-pgi`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PGI_SUBMIT_FAILED");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
  });
});
