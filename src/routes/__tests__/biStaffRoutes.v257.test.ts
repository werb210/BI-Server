// BI_SERVER_BLOCK_v257_STAFF_DIRECTORY_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { requireAuth } from "../../platform/auth";
import biStaffRoutes from "../biStaffRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/staff", requireAuth, biStaffRoutes);
  return app;
}
function staffToken(staffUserId = "staff-1") {
  return jwt.sign({ staffUserId, role: "staff" }, SECRET);
}

describe("BI_SERVER_BLOCK_v257 — GET /directory", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns active staff list", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { staff_user_id: "staff-1", full_name: "Andrew Werb", email: "andrew@boreal.financial", role: "admin" },
        { staff_user_id: "staff-2", full_name: null, email: null, role: null },
      ],
    });
    const r = await request(makeApp())
      .get("/api/v1/bi/staff/directory")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const list = r.body?.data ?? r.body;
    expect(list).toHaveLength(2);
    expect(list[0].full_name).toBe("Andrew Werb");
  });

  it("filters WHERE is_active = TRUE", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/staff/directory")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/is_active = TRUE/);
  });

  it("orders by full_name ASC NULLS LAST", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/staff/directory")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ORDER BY full_name ASC NULLS LAST/);
  });

  it("appends ILIKE on q parameter", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp())
      .get("/api/v1/bi/staff/directory?q=andrew")
      .set("Authorization", `Bearer ${staffToken()}`);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/ILIKE/);
    expect(params[0]).toBe("%andrew%");
  });
});

describe("BI_SERVER_BLOCK_v257 — GET /me", () => {
  beforeEach(() => queryMock.mockReset());

  it("returns current staff profile", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ staff_user_id: "staff-1", full_name: "Andrew", email: "a@b.com", role: "admin", is_active: true }],
    });
    const r = await request(makeApp())
      .get("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken("staff-1")}`);
    expect(r.status).toBe(200);
    const me = r.body?.data ?? r.body;
    expect(me.staff_user_id).toBe("staff-1");
    expect(me.full_name).toBe("Andrew");
  });

  it("returns null when staff has no profile yet", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .get("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });
});

describe("BI_SERVER_BLOCK_v257 — PUT /me", () => {
  beforeEach(() => queryMock.mockReset());

  it("creates a profile when none exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ staff_user_id: "staff-1", full_name: "Andrew", email: "a@b.com", role: null, is_active: true }],
      });
    const r = await request(makeApp())
      .put("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken("staff-1")}`)
      .send({ full_name: "Andrew", email: "A@B.COM" });
    expect(r.status).toBe(200);
    const me = r.body?.data ?? r.body;
    expect(me.full_name).toBe("Andrew");
    const insertCall = queryMock.mock.calls[0];
    expect(insertCall[1]).toContain("a@b.com");
  });

  it("rejects invalid email", async () => {
    const r = await request(makeApp())
      .put("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_email");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("updates only changed fields (PATCH-like)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ staff_user_id: "staff-1", full_name: "Andrew Werb", email: null, role: null, is_active: true }],
      });
    const r = await request(makeApp())
      .put("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ full_name: "Andrew Werb" });
    expect(r.status).toBe(200);
    const updateCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE bi_staff_profile SET"),
    );
    expect(updateCall).toBeDefined();
    expect(String(updateCall![0])).toMatch(/full_name = \$1/);
    expect(String(updateCall![0])).not.toMatch(/email =/);
    expect(String(updateCall![0])).not.toMatch(/role =/);
  });

  it("clears a field when null is sent", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ staff_user_id: "staff-1", full_name: null, email: null, role: null, is_active: true }],
      });
    const r = await request(makeApp())
      .put("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ full_name: null });
    expect(r.status).toBe(200);
    const updateCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE bi_staff_profile SET"),
    );
    expect(updateCall![1][0]).toBeNull();
  });

  it("does not run UPDATE when body is empty (no_op write)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ staff_user_id: "staff-1", full_name: null, email: null, role: null, is_active: true }],
      });
    const r = await request(makeApp())
      .put("/api/v1/bi/staff/me")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(200);
    const updateCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE bi_staff_profile SET"),
    );
    expect(updateCall).toBeUndefined();
  });
});
