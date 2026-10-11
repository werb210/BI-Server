// BI_SERVER_BLOCK_v373_SECOND_ACCEPT_AND_TEXT_BUNDLE_v1
// BI_SERVER_v789 [5]/[37] - behaviour tests (these used to grep the source of
// biApplicationDetailRoutes.ts and biPgiSubmissionService.ts).
//   Bug #22: the nested accept handler (/applications/:id/documents/:docId/accept)
//   backfills accepted documents to the carrier after a public auto-submit, and
//   does not auto-submit lender/referrer apps.
//   Bug #23: the carrier payload carries no documents_text bundle.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const pgiSubmitV2 = vi.fn();
const pgiUploadDocument = vi.fn();
vi.mock("../../services/pgiAdapter", async () => {
  const actual = await vi.importActual<typeof import("../../services/pgiAdapter")>("../../services/pgiAdapter");
  return { ...actual, pgiSubmitV2: (...a: unknown[]) => pgiSubmitV2(...a), pgiUploadDocument: (...a: unknown[]) => pgiUploadDocument(...a) };
});
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ get: async () => ({ buffer: Buffer.from("%PDF"), contentType: "application/pdf" }) }),
}));

import router from "../biApplicationDetailRoutes";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const APP = "77777777-7777-4777-8777-777777777777";
const DOC = "88888888-8888-4888-8888-888888888888";

function db(sourceType: string) {
  return answerBySql([
    [/SELECT d\.application_id, d\.doc_type, a\.source_type/, { rows: [{ application_id: APP, doc_type: "profit_loss", source_type: sourceType }], rowCount: 1 }],
    [/COUNT\(\*\) FILTER/, { rows: [{ pending: "0", accepted: "1", total: "1" }] }],
    [/SET submission_locked = TRUE/, { rows: [{ id: APP }], rowCount: 1 }],
    [/FROM bi_applications a\s+LEFT JOIN bi_companies/, { rows: [{ id: APP, guarantor_name: "G", guarantor_email: "g@x.test", lender_name: null, company_name: "Acme" }] }],
    [/review_status = 'accepted'\s+AND pgi_document_id IS NULL/, { rows: [
      { id: "d1", doc_type: "profit_loss", original_filename: "pl.pdf", mime_type: "application/pdf", storage_key: "k1", blob_name: "k1", bf_document_id: null },
    ] }],
  ], { rows: [], rowCount: 1 });
}

function accept() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as any).user = { role: "staff", staffUserId: null }; next(); });
  a.use("/api/v1/bi/applications", router);
  return request(a).post(`/api/v1/bi/applications/${APP}/documents/${DOC}/accept`).send({});
}

beforeEach(() => {
  pgiSubmitV2.mockReset().mockResolvedValue({ application_id: "PGI-373", status: "received" });
  pgiUploadDocument.mockReset().mockResolvedValue({ document_id: "PGI-DOC-1", doc_type: "profit_loss", received_at: "now" });
});

describe("v373 - duplicate doc-accept handler backfills (Bug #22)", () => {
  it("a public app: auto-submits, then forwards the accepted docs and records pgi_document_id", async () => {
    poolQuery.mockReset().mockImplementation(db("public"));
    const r = await accept();
    expect(r.status).toBe(200);
    expect(r.body.autoSubmittedToPgi).toBe(true);
    expect(pgiUploadDocument).toHaveBeenCalledTimes(1);
    expect(pgiUploadDocument.mock.calls[0]![0]).toMatchObject({ pgiApplicationId: "PGI-373", docType: "profit_loss" });
    const upd = callsMatching(poolQuery, /SET pgi_document_id = \$1,\s+forwarded_to_carrier_at = NOW\(\)/);
    expect(upd).toHaveLength(1);
    expect(upd[0]![1]).toEqual(["PGI-DOC-1", "d1"]);
  });

  it("lender/referrer apps are view-only: no submit, no backfill", async () => {
    poolQuery.mockReset().mockImplementation(db("lender"));
    const r = await accept();
    expect(r.status).toBe(403);
    expect(pgiSubmitV2).not.toHaveBeenCalled();
    expect(pgiUploadDocument).not.toHaveBeenCalled();
  });
});

describe("v373 - documents_text removed from carrier payload (Bug #23)", () => {
  it("the payload sent to the carrier has no documents_text", async () => {
    poolQuery.mockReset().mockImplementation(db("public"));
    await accept();
    expect(pgiSubmitV2).toHaveBeenCalledTimes(1);
    const payload = pgiSubmitV2.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toBeTypeOf("object");
    expect("documents_text" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("documents_text");
  });
});
