// BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// v334: vi.mock factories are hoisted; bare `const` after them isn't.
// Move shared values into vi.hoisted() so they exist at factory time.
const { queryMock, SECRET } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  SECRET: "test-shared-secret-min-10",
}));
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import router from "../biApplicationsFromBfRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function serviceToken() {
  return jwt.sign({ kind: "service", source: "bf-server" }, SECRET);
}

const validPayload = {
  bf_application_id: "bf-app-0001",
  guarantor_name: "Jane Doe",
  guarantor_email: "jane@example.com",
  guarantor_phone: "+14165551234",
  business_name: "Acme Inc",
  lender_name: "Test Lender",
  loan_amount: 250000,
  annual_revenue: 1200000,
};

describe("BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1", () => {
  beforeEach(() => queryMock.mockReset());

  it("rejects requests without a service JWT", async () => {
    const res = await request(makeApp())
      .post("/applications/from-bf")
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  it("rejects a JWT with the wrong kind", async () => {
    const bad = jwt.sign({ kind: "lender", id: "x" }, SECRET);
    const res = await request(makeApp())
      .post("/applications/from-bf")
      .set("Authorization", `Bearer ${bad}`)
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  it("rejects when bf_application_id is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp())
      .post("/applications/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send({ ...validPayload, bf_application_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bf_application_id_required");
  });

  it("creates a new BI application and returns a completion_url", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(makeApp())
      .post("/applications/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send(validPayload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.public_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.application_code).toMatch(/^BI-/);
    expect(res.body.completion_url).toMatch(/^https:\/\/www\.boreal\.insure\/login\?next=/);
    expect(res.body.completion_url).toContain(encodeURIComponent(res.body.public_id));
  });

  it("returns the existing row when BF resubmits (idempotency)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ public_id: "existing-pub-id", application_code: "BI-EXIST1" }],
    });
    const res = await request(makeApp())
      .post("/applications/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send(validPayload);
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.public_id).toBe("existing-pub-id");
  });

  it("defaults pgi_limit to 80% of loan_amount when not provided", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await request(makeApp())
      .post("/applications/from-bf")
      .set("Authorization", `Bearer ${serviceToken()}`)
      .send({ ...validPayload, loan_amount: 100000, pgi_limit: undefined });
    const insertArgs = queryMock.mock.calls[1][1];
    // pgi_limit is the 11th positional arg in the INSERT.
    expect(insertArgs[10]).toBe(80000);
  });
});
