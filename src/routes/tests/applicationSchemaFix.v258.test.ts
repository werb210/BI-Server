// BI_SERVER_BLOCK_v258_APPLICATION_SCHEMA_FIX_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({ env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../services/otpService", () => ({ sendOtp: vi.fn(), verifyOtp: vi.fn(async () => true) }));

import { requireAuth } from "../../platform/auth";
import biLenderApiRoutes from "../biLenderApiRoutes";
import biReferrerRoutes from "../biReferrerRoutes";
import biLenderApplicationCreate from "../biLenderApplicationCreate";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/lender", requireAuth, biLenderApiRoutes);
  app.use("/api/v1/lender", requireAuth, biLenderApplicationCreate);
  app.use("/api/v1/referrer", biReferrerRoutes);
  return app;
}
function lenderToken() { return jwt.sign({ kind: "lender", id: "lender-1", user_id: "user-1", lender_id: "lender-1" }, SECRET); }

describe("v258 GET mine", () => {
  beforeEach(() => queryMock.mockReset());
  it("uses join", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).get("/api/v1/lender/lender/applications/mine").set("Authorization", `Bearer ${lenderToken()}`);
    const s = String(queryMock.mock.calls[0][0]);
    expect(s).toMatch(/LEFT JOIN bi_companies/i);
    expect(s).not.toMatch(/bi_applications\.company_name|a\.company_name/);
  });
});

describe("v258 lender create", () => {
  beforeEach(() => queryMock.mockReset());
  it("creates company when missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "co-new" }] }).mockResolvedValue({ rows: [{ id: "app-1", application_code: "BI-A1" }] });
    const r = await request(makeApp()).post("/api/v1/lender/lender/applications").set("Authorization", `Bearer ${lenderToken()}`).send({ company_name: "Acme Inc", contact_name: "Jane Doe", contact_email: "jane@acme.test", contact_phone: "+14165551234" });
    expect([200, 201]).toContain(r.status);
    const insertCall = queryMock.mock.calls.find((c) => String(c[0]).match(/INSERT INTO bi_applications/i));
    expect(String(insertCall![0])).toMatch(/company_id/);
    expect(String(insertCall![0])).not.toMatch(/company_name/);
    expect(insertCall![1]).toContain("co-new");
  });
  it("reuses existing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "co-existing" }] }).mockResolvedValue({ rows: [{ id: "app-1", application_code: "BI-A1" }] });
    await request(makeApp()).post("/api/v1/lender/lender/applications").set("Authorization", `Bearer ${lenderToken()}`).send({ company_name: "ACME INC", contact_name: "Jane", contact_email: "j@a.com", contact_phone: "+14165551234" });
    expect(queryMock.mock.calls.find((c) => String(c[0]).match(/INSERT INTO bi_companies/i))).toBeUndefined();
  });
});

describe("v258 referrer verify", () => {
  beforeEach(() => queryMock.mockReset());
  it("uses phone_e164", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).post("/api/v1/referrer/referrer/otp/verify").send({ phone: "+14165551234", code: "123456" });
    const selectCall = queryMock.mock.calls.find((c) => String(c[0]).match(/bi_referrer_codes/i));
    expect(String(selectCall![0])).toMatch(/phone_e164\s*=/);
    expect(String(selectCall![0])).not.toMatch(/\bphone\s*=\s*\$/);
  });
});
