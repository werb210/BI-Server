// BI_SERVER_PGI_MIRROR_VOCAB_v1
// v789 [5]/[37]: the biDocumentsFromBfRoutes.ts greps are now mirror requests to
// the real router, asserting on the bi_documents INSERT it sends. The
// pgiCompletion.ts and migration checks read files this block did not change
// and stay as source checks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { insertColumns } from "../../__tests__/helpers/insertColumns";

const db = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn() }));
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => db.query(...a),
    connect: async () => ({ query: (...a: unknown[]) => db.clientQuery(...a), release: () => undefined }),
  },
}));
vi.mock("../../services/pgiCompletion", () => ({ evaluatePgiCompletion: vi.fn(async () => undefined) }));

import biDocumentsFromBfRoutes from "../biDocumentsFromBfRoutes";

const completionSource = readFileSync("src/services/pgiCompletion.ts", "utf8");
const migration = readFileSync("src/db/migrations/2026_09_10_pgi_catalog_required_flag_v1.sql", "utf8");
const ACTIVE_CATALOG = ["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"];

beforeEach(() => {
  db.query.mockReset();
  db.clientQuery.mockReset();
  db.query.mockImplementation(answerBySql([["FROM bi_applications WHERE public_id", { rows: [{ id: "bi-app-1" }], rowCount: 1 }]]));
  db.clientQuery.mockImplementation(answerBySql([["INSERT INTO bi_documents", { rows: [{ id: "doc-1" }], rowCount: 1 }]]));
});

async function mirrored(body: Record<string, unknown>) {
  db.clientQuery.mockClear();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", biDocumentsFromBfRoutes);
  const token = jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string);
  const r = await request(app).post("/api/v1/bi/applications/pub-1/documents/from-bf")
    .set("Authorization", `Bearer ${token}`).send({ bf_document_id: "bf-doc-1", ...body });
  expect(r.status).toBe(200);
  const [call] = callsMatching(db.clientQuery, "INSERT INTO bi_documents");
  return insertColumns(String(call![0]), call![1] as unknown[]);
}

describe("BI_SERVER_PGI_MIRROR_VOCAB_v1", () => {
  it("maps every active catalog doc_type to itself", async () => {
    for (const t of ACTIVE_CATALOG) expect((await mirrored({ document_type: t })).doc_type.value, t).toBe(t);
  });
  it("no longer resolves loan_agreement to the deactivated loan_agreement_signed", async () => {
    expect((await mirrored({ document_type: "loan_agreement" })).doc_type.value).toBe("loan_agreement");
  });
  it("preserves BF's own category in document_type_legacy", async () => {
    const row = await mirrored({ document_type: "profit_loss", bf_document_type: "Financials" });
    expect(row.document_type.value).toBe("profit_loss");
    expect(row.document_type_legacy.value).toBe("Financials");
    // Without a separate BF category, the raw document_type is kept.
    expect((await mirrored({ document_type: "bank_statements" })).document_type_legacy.value).toBe("bank_statements");
  });
});
describe("BI_PGI_REQUIRED_FLAG_v1", () => {
  it("gates completion on required rows only", () => expect(completionSource).toContain("COALESCE(c.required, TRUE) = TRUE"));
  it("adds the column idempotently and marks the six optional rows", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT TRUE");
    expect(migration).toContain("'profit_loss','balance_sheet','ar_aging','ap_aging','founder_cv','financial_forecast'");
    expect(migration).toContain("WHERE doc_type = 'loan_agreement'");
  });
});
