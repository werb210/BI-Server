// BI_SERVER_BLOCK_v368_PUBLIC_DOC_ALLOWLIST_v1
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const putMock = vi.fn();
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: (...a: unknown[]) => putMock(...a) }) }));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn().mockResolvedValue(undefined) }));

import router from "../biPublicApplicationRoutes";

const app = express().use(express.json()).use(router);
const PDF = Buffer.from("%PDF-1.4\n%test\n");
const ALLOWED = ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"];

describe("v368 - public doc upload allowlist", () => {
  beforeEach(() => {
    putMock.mockReset().mockResolvedValue({ blobName: "b", url: "u", hash: "h", sizeBytes: 1 });
    queryMock.mockReset().mockImplementation(answerBySql([
      ["SELECT id, score_decision, status, source FROM bi_applications", { rows: [{ id: "app-1", score_decision: "approve", status: "in_progress", source: "public" }] }],
      ["INSERT INTO bi_documents", (_s: string, p?: unknown[]) => ({ rows: [{ id: `doc-${String(p?.[1])}` }] })],
    ]));
  });

  it("accepts each of the 7 carrier-allowed doc types", async () => {
    for (const t of ALLOWED) {
      const res = await request(app).post("/applications/ABCDEFGH/documents")
        .field("doc_types", t).attach("files", PDF, { filename: "f.pdf", contentType: "application/pdf" });
      expect(res.status, t).toBe(200);
      expect(res.body.documents[0].doc_type).toBe(t);
    }
  });

  it("returns 400 invalid_doc_type with the allowed list on a miss", async () => {
    const res = await request(app).post("/applications/ABCDEFGH/documents")
      .field("doc_types", "tax_return").attach("files", PDF, { filename: "f.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_doc_type", invalid_value: "tax_return", file_index: 0 });
    expect(res.body.allowed.sort()).toEqual([...ALLOWED].sort());
    expect(putMock).not.toHaveBeenCalled();
  });

  it("no longer silently defaults a missing type to 'other'", async () => {
    const res = await request(app).post("/applications/ABCDEFGH/documents")
      .attach("files", PDF, { filename: "f.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_doc_type", invalid_value: null });
  });
});
