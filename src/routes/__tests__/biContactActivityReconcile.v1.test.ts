// BI_SERVER_CONTACT_ACTIVITY_RECONCILE_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const queryMock = vi.fn();
vi.mock("pg", () => ({ Pool: class { query(...args: unknown[]) { return queryMock(...args); } } }));
const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({ env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";

function makeApp() { const app = express(); app.use(express.json()); app.use("/api/v1/bi", requireAuth, biCrmRoutes); return app; }
function staffToken() { return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET); }
const LIVE_COLUMNS = ["id", "contact_id", "actor_id", "actor_name", "event_type", "outcome", "body", "meta", "created_at", "occurred_at"];

describe("BI_SERVER_CONTACT_ACTIVITY_RECONCILE_v1", () => {
  beforeEach(() => queryMock.mockReset());
  it("selects only live columns and returns events", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "a1", event_type: "call" }] });
    const res = await request(makeApp()).get("/api/v1/bi/crm/contacts/bc1/timeline").set("Authorization", `Bearer ${staffToken()}`).expect(200);
    const sql = String(queryMock.mock.calls[0]![0]);
    expect(sql).not.toMatch(/\b(summary|metadata|kind|payload|actor_user_id)\b/);
    const selected = sql.slice(sql.indexOf("SELECT") + 6, sql.indexOf("FROM")).split(",").map((part) => part.trim());
    for (const column of selected) expect(LIVE_COLUMNS).toContain(column);
    expect(res.body.events[0].event_type).toBe("call");
  });
  it("joins using actor_id", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).get("/api/v1/bi/crm/contacts/bc1/activity").set("Authorization", `Bearer ${staffToken()}`).expect(200);
    expect(String(queryMock.mock.calls[0]![0])).toContain("p.staff_user_id::text = a.actor_id");
  });
  it("handles activity query failures", async () => {
    queryMock.mockRejectedValueOnce(new Error("column does not exist"));
    await request(makeApp()).get("/api/v1/bi/crm/contacts/bc1/activity").set("Authorization", `Bearer ${staffToken()}`).expect(500);
  });
  it("contains an additive migration that relaxes v108 kind", () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/2026_08_03_bi_contact_activity_reconcile_v1.sql"), "utf8");
    for (const col of ["actor_id", "actor_name", "event_type", "outcome", "body", "meta", "created_at", "occurred_at"]) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    expect(sql).toContain("ALTER COLUMN kind DROP NOT NULL");
    expect(sql).toContain("DROP CONSTRAINT");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|SET\s+NOT\s+NULL/i);
  });
});
