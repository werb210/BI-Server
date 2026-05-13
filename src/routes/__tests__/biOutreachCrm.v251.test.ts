// BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1
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
  env: { JWT_SECRET: SECRET, DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import router from "../biOutreachCrmRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function staffToken(extra: Record<string, unknown> = {}) {
  return jwt.sign({ staffUserId: "staff-1", role: "staff", ...extra }, SECRET);
}

describe("BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — auth", () => {
  it("rejects requests without an Authorization header", async () => {
    const r = await request(makeApp()).get("/crm/outreach/contacts");
    expect(r.status).toBe(401);
  });
});

describe("BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — GET /crm/outreach/contacts", () => {
  beforeEach(() => queryMock.mockReset());

  it("lists contacts with no filters", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "c1", full_name: "Jane", outreach_status: "cold" }],
    });
    const r = await request(makeApp())
      .get("/crm/outreach/contacts")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.contacts).toHaveLength(1);
  });

  it("400s on invalid status filter", async () => {
    const r = await request(makeApp())
      .get("/crm/outreach/contacts?status=bogus")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_status");
  });

  it("owner=mine binds the staffUserId from the JWT", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .get("/crm/outreach/contacts?owner=mine")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toContain("staff-1");
  });
});

describe("BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — PATCH /crm/outreach/contacts/:id", () => {
  beforeEach(() => queryMock.mockReset());

  it("updates status and auto-logs the change", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ outreach_status: "cold" }] }) // existing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                // INSERT activity
    const r = await request(makeApp())
      .patch("/crm/outreach/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ outreach_status: "engaged" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // The third call must be the activity insert.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("does not log when status is unchanged", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ outreach_status: "engaged" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const r = await request(makeApp())
      .patch("/crm/outreach/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ outreach_status: "engaged" });
    expect(r.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("404s when the contact does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .patch("/crm/outreach/contacts/missing")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ outreach_status: "engaged" });
    expect(r.status).toBe(404);
  });

  it("400s on invalid status", async () => {
    const r = await request(makeApp())
      .patch("/crm/outreach/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ outreach_status: "weird" });
    expect(r.status).toBe(400);
  });
});

describe("BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — POST /crm/outreach/contacts/:id/activity", () => {
  beforeEach(() => queryMock.mockReset());

  it("logs a call with outcome=spoke and bumps status to engaged", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ "1": 1 }] })           // contact exists
      .mockResolvedValueOnce({ rows: [{ id: "act-1" }] })       // INSERT activity
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });         // status bump
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/activity")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ event_type: "call", outcome: "spoke", body: "Connected, demo next week." });
    expect(r.status).toBe(200);
    expect(r.body.activity_id).toBe("act-1");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("400s on invalid event_type", async () => {
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/activity")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ event_type: "telepathy" });
    expect(r.status).toBe(400);
  });
});

describe("BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1 — staff profile", () => {
  beforeEach(() => queryMock.mockReset());

  it("GET returns an empty default when no row exists", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .get("/crm/outreach/me/profile")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.exists).toBe(false);
    expect(r.body.profile.staff_user_id).toBe("staff-1");
  });

  it("PUT upserts the profile", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const r = await request(makeApp())
      .put("/crm/outreach/me/profile")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({
        display_name: "Andrew",
        bookings_url: "https://outlook.office.com/bookings/xyz",
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("PUT rejects non-HTTPS bookings_url", async () => {
    const r = await request(makeApp())
      .put("/crm/outreach/me/profile")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ bookings_url: "http://example.com/bookings" });
    expect(r.status).toBe(400);
  });
});
