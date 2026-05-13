// BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v1
// Smoke tests for the two failures bleeding through after v258.
// Each test asserts the SQL string used by the route — no DB
// required — so failures are immediate and unambiguous.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../services/otpService", () => ({
  sendOtp: vi.fn(async () => true),
  verifyOtp: vi.fn(async () => true),
}));
vi.mock("../../util/phoneE164", () => ({
  normalizeE164: (s: unknown) =>
    typeof s === "string" && s.trim() ? `+1${s.replace(/\D/g, "")}` : null,
}));

import biReferrerRoutes from "../biReferrerRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", biReferrerRoutes);
  return app;
}

describe("BI_SERVER_BLOCK_v259 — referrer OTP verify uses phone_e164", () => {
  beforeEach(() => queryMock.mockReset());

  it("SELECT and INSERT on bi_referrers both use phone_e164", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // first SELECT
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ id: "r1", intake_complete: false }] });
    const r = await request(makeApp())
      .post("/api/v1/referrer/otp/verify")
      .send({ phone: "+14165551234", code: "123456" });
    expect(r.status).toBe(200);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    // every SQL string in this handler must use phone_e164
    for (const sql of sqls) {
      expect(sql).toMatch(/phone_e164/);
      expect(sql).not.toMatch(/\bphone\b\s*=/);
    }
  });
});

describe("BI_SERVER_BLOCK_v259 — referrer dashboard aliases phone_e164 AS phone", () => {
  beforeEach(() => queryMock.mockReset());

  it("dashboard SQL selects phone_e164 AS phone", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const jwt = (await import("jsonwebtoken")).default;
    const token = jwt.sign({ kind: "referrer", id: "r1" }, SECRET);
    await request(makeApp())
      .get("/api/v1/referrer/dashboard")
      .set("Authorization", `Bearer ${token}`);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/phone_e164\s+AS\s+phone/i);
  });
});

describe("BI_SERVER_BLOCK_v259 — POST /referrer/referrals writes phone_e164", () => {
  beforeEach(() => queryMock.mockReset());

  it("INSERT into bi_referrals uses phone_e164", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "ref-1" }] }) // INSERT bi_referrals
      .mockResolvedValueOnce({ rows: [] }); // INSERT bi_contacts
    const jwt = (await import("jsonwebtoken")).default;
    const token = jwt.sign({ kind: "referrer", id: "r1" }, SECRET);
    const r = await request(makeApp())
      .post("/api/v1/referrer/referrals")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "Jane", email: "jane@a.com", phone: "+14165551234" });
    expect(r.status).toBe(201);
    const [sql0] = queryMock.mock.calls[0];
    expect(String(sql0)).toMatch(/INSERT INTO bi_referrals.*phone_e164/s);
    const [sql1] = queryMock.mock.calls[1];
    expect(String(sql1)).toMatch(/INSERT INTO bi_contacts.*phone_e164/s);
    expect(String(sql1)).not.toMatch(/bi_contacts.*company_name/s);
  });
});
