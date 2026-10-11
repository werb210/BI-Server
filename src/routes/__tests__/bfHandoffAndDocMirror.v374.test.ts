// BI_BF_HANDOFF_LOAN_CAP_v374 / BI_DOC_MIRROR_SUPERSEDE_v374
// v789 [5]/[37]: the route halves were greps of biApplicationsFromBfRoutes.ts and
// biDocumentsFromBfRoutes.ts; they now post to the real routers and assert on the
// SQL sent to the mocked pool. The migration check reads a .sql file and stays.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerBySql, callsMatching, rejects, sqlText } from "../../__tests__/helpers/answerBySql";
import { insertColumns } from "../../__tests__/helpers/insertColumns";

const db = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => db.query(...a),
    connect: async () => ({ query: (...a: unknown[]) => db.clientQuery(...a), release: () => db.release() }),
  },
}));
vi.mock("../../services/pgiCompletion", () => ({ evaluatePgiCompletion: vi.fn(async () => undefined) }));

import biApplicationsFromBfRoutes from "../biApplicationsFromBfRoutes";
import biDocumentsFromBfRoutes from "../biDocumentsFromBfRoutes";

const root = process.cwd();
const migration = readFileSync(join(root, "src/db/migrations/2026_09_21_v374_drop_loan_amount_cap.sql"), "utf8");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", biApplicationsFromBfRoutes);
  a.use("/api/v1/bi", biDocumentsFromBfRoutes);
  return a;
}
const bf = () => `Bearer ${jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string)}`;

beforeEach(() => {
  db.query.mockReset();
  db.clientQuery.mockReset();
  db.release.mockReset();
  db.query.mockImplementation(answerBySql([
    ["SELECT id FROM bi_applications WHERE public_id", { rows: [{ id: "bi-app-1" }], rowCount: 1 }],
    ["FROM bi_applications", { rows: [], rowCount: 0 }],
  ]));
  db.clientQuery.mockImplementation(answerBySql([
    ["INSERT INTO bi_documents", { rows: [{ id: "doc-1" }], rowCount: 1 }],
  ]));
});

async function guaranteeFor(body: Record<string, unknown>) {
  const r = await request(app()).post("/api/v1/bi/applications/from-bf").set("Authorization", bf())
    .send({ bf_application_id: "bf-374", ...body });
  expect(r.status).toBe(200);
  const [call] = callsMatching(db.query, "INSERT INTO bi_applications");
  db.query.mockClear();
  return insertColumns(String(call![0]), call![1] as unknown[]);
}

describe("BF->BI handoff of large loans", () => {
  it("drops the loan-amount cap idempotently and keeps the guarantee cap", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS bi_applications_loan_amount_max_chk");
    expect(migration).not.toContain("pgi_limit_max_chk");
  });
  it("clamps the derived guarantee to the carrier maximum", async () => {
    const big = await guaranteeFor({ loan_amount: 5_000_000 });
    expect(big.loan_amount.value).toBe(5_000_000);
    expect(big.pgi_limit.value).toBe(1_000_000);
    expect((await guaranteeFor({ loan_amount: 250_000 })).pgi_limit.value).toBe(200_000);
    expect((await guaranteeFor({ loan_amount: 100_000, pgi_limit: 2_500_000 })).pgi_limit.value).toBe(1_000_000);
  });
});

describe("BF document mirror", () => {
  const mirror = (body: Record<string, unknown> = {}) =>
    request(app()).post("/api/v1/bi/applications/pub-1/documents/from-bf").set("Authorization", bf())
      .send({ bf_document_id: "bf-doc-2", document_type: "balance_sheet", file_name: "bs.pdf", ...body });

  it("supersedes the older active document of the same type in one transaction", async () => {
    const r = await mirror();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, bi_document_id: "doc-1", bi_application_id: "bi-app-1" });
    const statements = db.clientQuery.mock.calls.map((c) => sqlText(c[0]));
    const begin = statements.indexOf("BEGIN");
    const purge = statements.findIndex((s) => /UPDATE bi_documents\s+SET purged_at = NOW\(\)/.test(s));
    const insert = statements.findIndex((s) => s.includes("INSERT INTO bi_documents"));
    expect(begin).toBe(0);
    expect(purge).toBeGreaterThan(begin);
    expect(insert).toBeGreaterThan(purge);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    // Only OTHER BF documents of this type are superseded, never the one being sent.
    expect(statements[purge]).toContain("bf_document_id IS DISTINCT FROM $3");
    expect(db.clientQuery.mock.calls[purge]![1]).toEqual(["bi-app-1", "balance_sheet", "bf-doc-2"]);
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when the insert fails", async () => {
    db.clientQuery.mockImplementation(answerBySql([["INSERT INTO bi_documents", rejects(new Error("duplicate key secret detail"))]]));
    const r = await mirror();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, error: "insert_failed" });
    expect(JSON.stringify(r.body)).not.toContain("secret detail");
    const statements = db.clientQuery.mock.calls.map((c) => sqlText(c[0]));
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it("re-sending the same BF document revives it rather than duplicating", async () => {
    await mirror();
    const [insert] = callsMatching(db.clientQuery, "INSERT INTO bi_documents");
    const text = sqlText(insert![0]);
    expect(text).toMatch(/ON CONFLICT \(application_id, bf_document_id\)/);
    expect(text.slice(text.indexOf("DO UPDATE SET"))).toContain("purged_at = NULL,");
  });
});
