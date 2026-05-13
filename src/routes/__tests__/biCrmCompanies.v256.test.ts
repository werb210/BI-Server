// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const { SECRET } = vi.hoisted(() => ({
  SECRET: "test-shared-secret-min-10",
}));
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET, DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/crm", requireAuth, biCrmRoutes);
  return app;
}
function staffToken() {
  return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
}

describe("BI_SERVER_BLOCK_v256 — GET /crm/companies list", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns rows with contact_count rollup", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "co-1",
          legal_name: "Acme Inc",
          operating_name: "Acme",
          industry: "Software",
          created_at: "2026-05-01",
          contact_count: 3,
        },
      ],
    });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body[0].contact_count).toBe(3);
  });

  it("appends ILIKE filter when q is provided", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies?q=acme")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ILIKE/);
    expect(params[0]).toBe("%acme%");
  });

  it("whitelists sort columns and falls back to created_at desc", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies?sort=injection;DROP")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY created_at DESC/);
  });

  it("applies asc/desc when given a known sort column", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies?sort=name:asc")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY legal_name ASC/);
  });
});

describe("BI_SERVER_BLOCK_v256 — GET /crm/companies/:id detail", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns company + contacts + applications", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "co-1",
            legal_name: "Acme Inc",
            contact_count: 2,
            application_count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "c1", full_name: "Jane", outreach_status: "engaged" },
          { id: "c2", full_name: "Bob", outreach_status: null },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "a1", application_code: "BI-ABC", stage: "documents_pending", status: "in_progress" }],
      });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies/co-1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body.company.legal_name).toBe("Acme Inc");
    expect(body.contacts).toHaveLength(2);
    expect(body.applications).toHaveLength(1);
  });

  it("404s on missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies/missing")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(404);
  });

  it("degrades gracefully when bi_applications has no company_id column", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "co-1", legal_name: "Acme" }] })
      .mockResolvedValueOnce({ rows: [] }) // contacts
      .mockRejectedValueOnce(new Error('column "company_id" does not exist'));
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/companies/co-1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body.applications).toEqual([]);
  });
});

describe("BI_SERVER_BLOCK_v256 — POST /crm/companies", () => {
  beforeEach(() => queryMock.mockReset());

  it("400s without legal_name", async () => {
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/companies")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ industry: "Software" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("legal_name_required");
  });

  it("201s with id on success", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "co-new" }] });
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/companies")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ legal_name: "Acme Inc", industry: "Software" });
    expect(r.status).toBe(201);
    expect(r.body.id).toBe("co-new");
  });
});

describe("BI_SERVER_BLOCK_v256 — PATCH /crm/companies/:id", () => {
  beforeEach(() => queryMock.mockReset());

  it("no_op on empty body", async () => {
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/companies/co-1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.body.no_op).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("updates allowed fields", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "co-1" }] });
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/companies/co-1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ legal_name: "Acme LLC", industry: "Manufacturing", city: "Calgary" });
    expect(r.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE bi_companies SET/);
    expect(params).toEqual(["Acme LLC", "Calgary", "Manufacturing", "co-1"]);
  });

  it("400s when trying to clear legal_name", async () => {
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/companies/co-1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ legal_name: null });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("legal_name_required");
  });

  it("404s when company is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/companies/missing")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ city: "Calgary" });
    expect(r.status).toBe(404);
  });
});
