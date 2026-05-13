// BI_SERVER_BLOCK_v254_CRM_CONTACTS_ENHANCED_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("pg", () => ({
  Pool: class {
    query(...args: unknown[]) {
      return queryMock(...args);
    }
  },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" },
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

describe("BI_SERVER_BLOCK_v254 — GET /crm/contacts list", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns rows with the enhanced shape (company_name joined)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "c1",
          full_name: "Jane Doe",
          email: "jane@example.com",
          phone_e164: "+14165551234",
          title: "CFO",
          tags: ["warm"],
          outreach_status: "engaged",
          outreach_owner_id: "staff-1",
          company_id: "co-1",
          company_name: "Acme Inc",
          created_at: "2026-05-01",
        },
      ],
    });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].company_name).toBe("Acme Inc");
    expect(body[0].outreach_status).toBe("engaged");
  });

  it("appends ILIKE filter when q is provided", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts?q=acme")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ILIKE/);
    expect(params[0]).toBe("%acme%");
  });

  it("filters by owner_id and lead_status", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts?owner_id=staff-1&lead_status=engaged")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/outreach_owner_id/);
    expect(String(sql)).toMatch(/outreach_status/);
    expect(params).toEqual(["staff-1", "engaged"]);
  });

  it("whitelists sort columns and falls back to created_at desc", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts?sort=injection;DROP")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY c\.created_at DESC/);
  });

  it("applies asc/desc when given a known sort column", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts?sort=name:asc")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY c\.full_name ASC/);
  });

  it("caps pageSize at 500 and accepts page offsetting", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts?page=3&pageSize=9999")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/LIMIT 500/);
    expect(String(sql)).toMatch(/OFFSET 1000/);
  });
});

describe("BI_SERVER_BLOCK_v254 — GET /crm/contacts/:id detail", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns the contact with activity_count", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "c1",
          full_name: "Jane Doe",
          email: "jane@example.com",
          company_name: "Acme",
          activity_count: 7,
        },
      ],
    });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body.activity_count).toBe(7);
  });

  it("404s when no row matches", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .get("/api/v1/bi/crm/crm/contacts/missing")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(404);
  });
});
