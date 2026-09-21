// BI_SERVER_WITHDRAW_BF_MIRROR_v394
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const { queryMock, SECRET } = vi.hoisted(() => ({ queryMock: vi.fn(), SECRET: "test-shared-secret-min-10" }));
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
vi.mock("../../platform/env", () => ({ env: { JWT_SECRET: SECRET } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import router from "../biDocumentsFromBfRoutes";

const app = () => { const a = express(); a.use(express.json()); a.use(router); return a; };
const token = (source = "bf-server") => jwt.sign({ kind: "service", source }, SECRET);
const url = "/applications/pub-1/documents/from-bf/withdraw";

describe("withdraw a BF-mirrored document", () => {
  beforeEach(() => queryMock.mockReset());

  it("needs the BF service token", async () => {
    expect((await request(app()).post(url).send({ bf_document_id: "d1" })).status).toBe(401);
    expect((await request(app()).post(url).set("Authorization", `Bearer ${token("other")}`).send({ bf_document_id: "d1" })).status).toBe(403);
  });

  it("retires the copy unless BI staff accepted it", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "bi-app" }] })
      .mockResolvedValueOnce({ rows: [{ id: "bi-doc" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post(url).set("Authorization", `Bearer ${token()}`).send({ bf_document_id: "d1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, withdrawn: 1, kept_accepted: false });
    const sql = String(queryMock.mock.calls[1][0]);
    expect(sql).toContain("SET purged_at = NOW()");
    expect(sql).toContain("COALESCE(review_status, 'pending') <> 'accepted'");
  });

  it("reports an accepted copy as kept", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "bi-app" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "bi-doc" }] });
    const res = await request(app()).post(url).set("Authorization", `Bearer ${token()}`).send({ bf_document_id: "d1" });
    expect(res.body).toMatchObject({ ok: true, withdrawn: 0, kept_accepted: true });
  });

  it("404s an unknown BI application", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post(url).set("Authorization", `Bearer ${token()}`).send({ bf_document_id: "d1" });
    expect(res.status).toBe(404);
  });
});
