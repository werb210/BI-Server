// BI_SERVER_BLOCK_v371_DOC_UNIQUE_v1
// BI_SERVER_v789 [5]/[37] - the public upload route checks are behaviour tests
// now (the real biPublicApplicationRoutes router, db mocked by SQL content).
// Only the migration checks still read their .sql file.
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../../__tests__/helpers/answerBySql";
import { publicIp } from "../../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../index", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../../services/pgiAdapter", () => ({ pgiScore: vi.fn() }));
vi.mock("../../../lib/storage", () => ({
  getStorage: () => ({ put: async (a: { filename: string }) => ({ blobName: `b/${a.filename}`, url: `https://blob/${a.filename}`, hash: "h", sizeBytes: 9 }) }),
}));
vi.mock("../../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn().mockResolvedValue(undefined) }));

import publicRouter from "../../../routes/biPublicApplicationRoutes";

const sql = fs.readFileSync(path.resolve(__dirname, "../2026_05_26_doc_unique_v371.sql"), "utf8");

describe("v371 - migration", () => {
  it("dedupes existing data before adding unique index", () => {
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY application_id, doc_type/);
  });
  it("partial unique index on (application_id, doc_type) WHERE purged_at IS NULL", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_documents_app_doctype_unique[\s\S]*WHERE purged_at IS NULL/);
  });
});

describe("v371 - upload routes use ON CONFLICT DO UPDATE", () => {
  const app = express().use(express.json()).use("/api/v1", publicRouter);
  const upload = (name: string) => request(app).post("/api/v1/applications/PUB371/documents").set("X-Forwarded-For", publicIp())
    .field("doc_types", "profit_loss").attach("files", Buffer.from("%PDF-1.4\n"), { filename: name, contentType: "application/pdf" });
  const db = () => queryMock.mockReset().mockImplementation(answerBySql([
    ["SELECT id, score_decision, status, source FROM bi_applications", { rows: [{ id: "app-371", score_decision: "approve", status: "document_review" }] }],
    // The unique slot means a re-upload lands on the same row.
    ["INSERT INTO bi_documents", { rows: [{ id: "doc-371" }] }],
  ]));

  it("public path replaces on conflict", async () => {
    db();
    const first = await upload("pl-v1.pdf");
    const second = await upload("pl-v2.pdf");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.documents).toEqual([{ id: "doc-371", doc_type: "profit_loss", filename: "pl-v2.pdf" }]);
    const inserts = callsMatching(queryMock, "INSERT INTO bi_documents");
    expect(inserts).toHaveLength(2);
    for (const [text] of inserts) {
      expect(String(text)).toMatch(/ON CONFLICT \(application_id, doc_type\) WHERE purged_at IS NULL\s+DO UPDATE SET/);
    }
    expect((inserts[1][1] as unknown[]).slice(0, 3)).toEqual(["app-371", "profit_loss", "pl-v2.pdf"]);
  });
  // BI_SERVER_v789 - the lender uploads' replace-on-conflict is a behaviour
  // test now (mocked: src/routes/__tests__/lenderUpload.v789.test.ts, real
  // database: src/routes/__tests__/lenderFlows.v789.db.test.ts).
  it("re-upload resets carrier-forwarding state", async () => {
    db();
    await upload("pl.pdf");
    const text = String(callsMatching(queryMock, "INSERT INTO bi_documents")[0][0]);
    expect(text).toMatch(/pgi_document_id = NULL/);
    expect(text).toMatch(/forwarded_to_carrier_at = NULL/);
    expect(text).toMatch(/review_status = 'pending'/);
  });
});
