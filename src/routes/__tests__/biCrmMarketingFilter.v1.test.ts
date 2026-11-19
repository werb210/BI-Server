// BI_SERVER_CRM_MARKETING_FILTER_v1 - ?marketing=yes|no narrows the contact list like Boreal Financial's filter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("pg", () => ({ Pool: class { query(...args: unknown[]) { return queryMock(...args); } } }));
const SECRET = process.env.JWT_SECRET as string;
vi.mock("../../platform/env", () => ({ env: { JWT_SECRET: (process.env.JWT_SECRET as string), DATABASE_URL: "postgres://test" } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";

function app() { const a = express(); a.use(express.json()); a.use("/api/v1/bi/crm", requireAuth, biCrmRoutes); return a; }
const token = () => jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
const sqlOf = (a: unknown) => (typeof a === "string" ? a : String((a as { text?: string })?.text ?? ""));
const listSql = () => queryMock.mock.calls.map((c) => sqlOf(c[0])).find((s) => s.includes("SELECT c.id,")) ?? "";

describe("GET /crm/contacts?marketing=", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: unknown) => (/count\(\*\)/i.test(sqlOf(sql)) ? { rows: [{ total: 0, n: 0, count: 0 }] } : { rows: [] }));
  });
  it("yes keeps marketing contacts only", async () => {
    const r = await request(app()).get("/api/v1/bi/crm/crm/contacts?marketing=yes").set("Authorization", `Bearer ${token()}`);
    expect(r.status).toBe(200);
    expect(listSql()).toMatch(/WHERE[\s\S]*\(NOT COALESCE\(c\.outreach_excluded, false\)/);
    expect(listSql()).not.toMatch(/NOT \(NOT COALESCE/);
  });
  it("no keeps non-marketing contacts only", async () => {
    await request(app()).get("/api/v1/bi/crm/crm/contacts?marketing=no").set("Authorization", `Bearer ${token()}`);
    expect(listSql()).toMatch(/NOT \(NOT COALESCE\(c\.outreach_excluded, false\)/);
  });
  it("no filter by default", async () => {
    await request(app()).get("/api/v1/bi/crm/crm/contacts").set("Authorization", `Bearer ${token()}`);
    expect(listSql()).not.toMatch(/WHERE[^]*AND \(NOT COALESCE\(c\.outreach_excluded/);
  });
});
