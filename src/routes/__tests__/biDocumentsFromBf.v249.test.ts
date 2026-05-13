// BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import router from "../biDocumentsFromBfRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function serviceToken() {
  return jwt.sign({ kind: "service", source: "bf-server" }, SECRET);
}

const validBody = {
  bf_document_id: "bf-doc-001",
  bf_application_id: "bf-app-001",
  document_type: "bank_statement",
  file_name: "march.pdf",
  mime_type: "application/pdf",
  file_size: 12345,
  storage_url: "https://bf-blob.example/abc",
  uploaded_by_name: "Jane Doe",
};

describe("BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1", () => {
  beforeEach(() => queryMock.mockReset());

  it("rejects requests without a service JWT", async () => {
    const res = await request(makeApp())
      .post("/applications/pub-1/documents/from-bf")
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it("rejects a service JWT from the wrong source", async () => {
    const tok = jwt.sign({ kind: "service", source: "someone-else" }, SECRET);
    const res = await request(makeApp())
      .post("/applications/pub-1/documents/from-bf")
      .set("Authorization", `Bearer ${tok}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 400 when bf_document_id is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "bi-app-1" }] });
    const res = await request(makeApp())
      .post("/applications/pub-1/documents/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send({ ...validBody, bf_document_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bf_document_id_required");
  });

  it("returns 404 when the BI application is not found", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // app lookup empty
    const res = await request(makeApp())
      .post("/applications/no-such/documents/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("bi_application_not_found");
  });

  it("creates a new mirrored document on first call", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "bi-app-1" }] })   // app lookup
      .mockResolvedValueOnce({ rows: [] })                       // idempotency: none
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });          // insert
    const res = await request(makeApp())
      .post("/applications/pub-1/documents/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.bi_document_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.bi_application_id).toBe("bi-app-1");
  });

  it("returns the existing row on resubmit (idempotency)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "bi-app-1" }] })       // app lookup
      .mockResolvedValueOnce({ rows: [{ id: "existing-doc-id" }] }); // idempotency: hit
    const res = await request(makeApp())
      .post("/applications/pub-1/documents/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.bi_document_id).toBe("existing-doc-id");
  });
});
