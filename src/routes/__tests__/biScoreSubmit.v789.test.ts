// BI_SERVER_v789_SCORE_SUBMIT_GATES - POST /api/v1/applications/:id/submit-to-pgi
// is Admin only, takes the submission lock (submitApplicationToPGI's atomic
// claim), only counts accepted non-purged documents, forwards accepted docs,
// and never returns carrier error text. Carrier failures write
// carrier_submission_failed (once, in the service).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../platform/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { role: req.header("x-test-role") ?? "" }; next(); },
}));
const pgiSubmitV2 = vi.fn();
const pgiUploadDocument = vi.fn();
vi.mock("../../services/pgiAdapter", async () => {
  const actual = await vi.importActual<typeof import("../../services/pgiAdapter")>("../../services/pgiAdapter");
  return {
    ...actual,
    pgiSubmitV2: (...a: unknown[]) => pgiSubmitV2(...a),
    pgiUploadDocument: (...a: unknown[]) => pgiUploadDocument(...a),
    pgiScore: vi.fn(),
  };
});
vi.mock("../../services/pgiCarrierMapper", () => ({
  buildCarrierPayloadV2: () => ({ form_data: { q15_business_legal_name: "Acme" } }),
  buildCarrierPayloadFromRow: vi.fn(),
}));
const validate = vi.fn((p: unknown) => ({ ok: true, value: p }));
vi.mock("../../lib/validation/pgiFields", () => ({ validatePgiSubmissionV2: (p: unknown) => validate(p) }));
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ get: async () => ({ buffer: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }) }),
}));

import router from "../biScoreRoutes";
import { answerBySql, callsMatching, rejects, sqlText } from "../../__tests__/helpers/answerBySql";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const SLOTS = ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging"];

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", router);
  return a;
}
function submit(role = "Admin") {
  return request(app()).post(`/api/v1/applications/${APP_ID}/submit-to-pgi`).set("x-test-role", role).send({});
}

type Opts = { locked?: boolean; loanDoc?: boolean; slotStatus?: string; claimRows?: number };
function db(o: Opts = {}) {
  return answerBySql([
    ["SELECT * FROM bi_applications", { rows: [{ id: APP_ID, pgi_application_id: null, pgi_external_id: null, submission_locked: o.locked ?? false, formation_date: null, data: {}, has_co_guarantors: false }] }],
    [/doc_type IN \('loan_agreement', 'loan_agreement_signed'\)/, { rows: o.loanDoc === false ? [] : [{ "?column?": 1 }] }],
    ["AS slot, review_status AS status", { rows: SLOTS.map((slot) => ({ slot, status: o.slotStatus ?? "accepted" })) }],
    [/SET submission_locked = TRUE/, { rows: o.claimRows === 0 ? [] : [{ id: APP_ID }], rowCount: o.claimRows ?? 1 }],
    [/SELECT pgi_application_id, pgi_external_id, stage/, { rows: [{ pgi_application_id: null, pgi_external_id: null, stage: "documents_pending" }] }],
    [/FROM bi_applications a\s+LEFT JOIN bi_companies/, { rows: [{ id: APP_ID, guarantor_name: "G", guarantor_email: "g@x.test", lender_name: null, company_name: "Acme" }] }],
    [/review_status = 'accepted'\s+AND pgi_document_id IS NULL/, { rows: [
      { id: "d1", doc_type: "loan_agreement", original_filename: "la.pdf", mime_type: "application/pdf", storage_key: "k1", blob_name: "k1", bf_document_id: null },
      { id: "d2", doc_type: "profit_loss", original_filename: "pl.pdf", mime_type: "application/pdf", storage_key: "k2", blob_name: "k2", bf_document_id: null },
    ] }],
  ], { rows: [], rowCount: 1 });
}

beforeEach(() => {
  poolQuery.mockReset().mockImplementation(db());
  pgiSubmitV2.mockReset().mockResolvedValue({ application_id: "PGI-777", status: "received" });
  pgiUploadDocument.mockReset().mockImplementation(async (a: { docType: string }) => ({ document_id: `DOC-${a.docType}`, doc_type: a.docType, received_at: "now" }));
  validate.mockClear();
});

describe("submit-to-pgi gates (v789)", () => {
  it("is Admin only", async () => {
    const r = await submit("staff");
    expect(r.status).toBe(403);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("409 when the submission lock is held", async () => {
    poolQuery.mockImplementation(db({ locked: true }));
    const r = await submit();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ALREADY_LOCKED");
    expect(pgiSubmitV2).not.toHaveBeenCalled();
  });

  it("counts only accepted, non-purged loan agreements", async () => {
    poolQuery.mockImplementation(db({ loanDoc: false }));
    const r = await submit();
    expect(r.status).toBe(412);
    const q = sqlText(callsMatching(poolQuery, "loan_agreement_signed")[0]![0]);
    expect(q).toContain("review_status = 'accepted'");
    expect(q).toContain("purged_at IS NULL");
  });

  it("applies the per-slot readiness check of the staff path", async () => {
    poolQuery.mockImplementation(db({ slotStatus: "pending" }));
    const r = await submit();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("DOCS_NOT_READY");
    expect(r.body.pending).toEqual(SLOTS);
    expect(pgiSubmitV2).not.toHaveBeenCalled();
  });

  it("goes through the atomic claim: a concurrent submit gets 409 and no second carrier call", async () => {
    poolQuery.mockImplementation(db({ claimRows: 0 }));
    const r = await submit();
    expect(r.status).toBe(409);
    expect(pgiSubmitV2).not.toHaveBeenCalled();
  });

  it("submits the validated payload once and forwards the accepted documents", async () => {
    const r = await submit();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, pgi_application_id: "PGI-777", status: "submitted", docs_forwarded: { forwarded: 2, failed: 0 } });
    expect(pgiSubmitV2).toHaveBeenCalledTimes(1);
    expect(pgiSubmitV2.mock.calls[0]![0]).toEqual({ form_data: { q15_business_legal_name: "Acme" } });
    expect(pgiUploadDocument).toHaveBeenCalledTimes(2);
    expect(pgiUploadDocument.mock.calls[0]![0]).toMatchObject({ pgiApplicationId: "PGI-777" });
    expect(callsMatching(poolQuery, /SET pgi_document_id = \$1/)).toHaveLength(2);
    expect(callsMatching(poolQuery, /SET submission_locked = TRUE/)).toHaveLength(1);
  });

  it("a carrier failure: 502 with a code only, claim released, carrier_submission_failed written once", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("pgi_submit_failed status=500 body=SECRET carrier stack trace"));
    const r = await submit();
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("pgi_submit_failed");
    expect(JSON.stringify(r.body)).not.toContain("SECRET");
    expect(callsMatching(poolQuery, /SET submission_locked = FALSE/)).toHaveLength(1);
    const ev = callsMatching(poolQuery, "INSERT INTO bi_events");
    expect(ev).toHaveLength(1);
    expect(sqlText(ev[0]![0])).toContain("'carrier_submission_failed'");
    expect(ev[0]![1]).toEqual([APP_ID, expect.any(String)]);
    // The application row is not given the carrier text either.
    const mark = callsMatching(poolQuery, "score_decision='error'");
    expect(mark[0]![1]).toEqual(["pgi_submit_failed", APP_ID]);
  });

  it("a failure to write the event is logged, never thrown", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("down"));
    poolQuery.mockImplementation(answerBySql([["INSERT INTO bi_events", rejects(new Error("events table gone"))]], db()));
    const r = await submit();
    expect(r.status).toBe(502);
  });
});
