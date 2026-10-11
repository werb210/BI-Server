// v404 BI CRM bulk endpoints.
// BI_SERVER_v789 [5]/[37] - rewritten as a behaviour test (it used to grep
// src/routes/biCrmRoutes.ts for the route strings and SQL text).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { requireAuth } from "../platform/auth";
import biCrmRoutes from "../routes/biCrmRoutes";
import { answerBySql, callsMatching } from "../__tests__/helpers/answerBySql";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", requireAuth, biCrmRoutes);
  return app;
}
const token = () => jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string);
const post = (path: string, body: unknown) =>
  request(makeApp()).post(`/api/v1/bi${path}`).set("Authorization", `Bearer ${token()}`).send(body as object);

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

describe("v404 BI CRM bulk endpoints", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(answerBySql([], { rows: [], rowCount: 0 }));
  });

  it("contacts bulk-delete deletes the given ids", async () => {
    const r = await post("/crm/contacts/bulk-delete", { ids: IDS });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, deleted: 2 });
    const del = callsMatching(queryMock, /DELETE FROM bi_contacts WHERE id = ANY\(\$1::uuid\[\]\)/);
    expect(del).toHaveLength(1);
    expect(del[0]![1]).toEqual([IDS]);
  });

  it("contacts bulk-tag adds a lowercased tag", async () => {
    const r = await post("/crm/contacts/bulk-tag", { ids: IDS, tag: " Lender " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, tagged: 2 });
    const upd = callsMatching(queryMock, /UPDATE bi_contacts SET tags/);
    expect(upd[0]![1]).toEqual([["lender"], IDS]);
  });

  it("companies bulk-delete deletes the given ids", async () => {
    const r = await post("/crm/companies/bulk-delete", { ids: IDS });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(callsMatching(queryMock, /DELETE FROM bi_companies WHERE id = ANY\(\$1::uuid\[\]\)/)).toHaveLength(1);
  });

  it("companies bulk-tag adds the tag", async () => {
    const r = await post("/crm/companies/bulk-tag", { ids: IDS, tag: "vip" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, tagged: 2 });
    expect(callsMatching(queryMock, /UPDATE bi_companies SET tags/)[0]![1]).toEqual([["vip"], IDS]);
  });

  it("bulk endpoints reject an empty id list", async () => {
    expect((await post("/crm/contacts/bulk-delete", { ids: [] })).status).toBe(400);
    expect((await post("/crm/companies/bulk-tag", { ids: IDS })).status).toBe(400);
  });
});
