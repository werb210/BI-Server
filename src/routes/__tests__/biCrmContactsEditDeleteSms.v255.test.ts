// BI_SERVER_BLOCK_v255_CRM_CONTACTS_EDIT_DELETE_SMS_v1
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

const sendSmsMock = vi.fn();
vi.mock("../../services/smsService", () => ({
  sendOutreachSms: (...args: unknown[]) => sendSmsMock(...args),
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

describe("BI_SERVER_BLOCK_v255 — PATCH /crm/contacts/:id", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("400s on empty body (no_op)", async () => {
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.no_op).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("updates allowed fields and lowercases email", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "c1" }] });
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({
        full_name: "Jane D",
        email: "JANE@example.com",
        phone: "4165551234",
        title: "VP",
        notes: "Updated",
      });
    expect(r.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE bi_contacts SET/);
    // email normalized to lowercase
    expect(params).toContain("jane@example.com");
    // phone normalized to E.164
    expect(params).toContain("+14165551234");
    // updated_at = NOW() is in SET list (no param)
    expect(String(sql)).toMatch(/updated_at = NOW\(\)/);
  });

  it("400s on invalid email", async () => {
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_email");
  });

  it("404s when the contact does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .patch("/api/v1/bi/crm/crm/contacts/missing")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ title: "x" });
    expect(r.status).toBe(404);
  });

  it("clears a field when null is sent", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "c1" }] });
    await request(makeApp())
      .patch("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ title: null, notes: null });
    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
  });
});

describe("BI_SERVER_BLOCK_v255 — DELETE /crm/contacts/:id", () => {
  beforeEach(() => queryMock.mockReset());

  it("deletes when the row exists", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "c1" }] });
    const r = await request(makeApp())
      .delete("/api/v1/bi/crm/crm/contacts/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("404s when the row is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .delete("/api/v1/bi/crm/crm/contacts/missing")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(404);
  });
});

describe("BI_SERVER_BLOCK_v255 — POST /crm/contacts/:id/sms", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("400s when body is empty", async () => {
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/contacts/c1/sms")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("body_required");
  });

  it("404s when the contact is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/contacts/missing/sms")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ body: "Hi there" });
    expect(r.status).toBe(404);
  });

  it("400s when the contact has no phone", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ phone_e164: null }] });
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/contacts/c1/sms")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ body: "Hi" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("contact_has_no_phone");
  });

  it("sends the SMS and logs activity on success", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ phone_e164: "+14165551234" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // activity insert
    sendSmsMock.mockResolvedValueOnce({ sid: "SM999" });

    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/contacts/c1/sms")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ body: "Reminder: demo tomorrow at 2pm" });

    expect(r.status).toBe(200);
    expect(r.body.sid).toBe("SM999");
    expect(sendSmsMock).toHaveBeenCalledWith(
      "+14165551234",
      "Reminder: demo tomorrow at 2pm",
    );
    // activity insert fired
    const activityCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("bi_contact_activity"),
    );
    expect(activityCall).toBeDefined();
    expect(activityCall![1]).toContain("sent");
  });

  it("logs failed activity and returns 502 when Twilio throws", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ phone_e164: "+14165551234" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    sendSmsMock.mockRejectedValueOnce(new Error("twilio_21408"));
    const r = await request(makeApp())
      .post("/api/v1/bi/crm/crm/contacts/c1/sms")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ body: "Hi" });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("sms_failed");
    const activityCall = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("bi_contact_activity"),
    );
    expect(activityCall![1]).toContain("failed");
  });
});
