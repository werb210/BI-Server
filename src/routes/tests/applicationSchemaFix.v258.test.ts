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
vi.mock("../../services/otpService", () => ({
  sendOtpSafe: vi.fn(),
  verifyOtpSafe: vi.fn(async () => ({ ok: true, approved: true })),
}));

import biLenderApiRoutes from "../biLenderApiRoutes";
import biLenderApplicationCreate from "../biLenderApplicationCreate";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

// BI_SERVER_v789_LENDER_ACTIVE - lender auth checks the lender + contact are active first.
const ACTIVE_LENDER: [RegExp, unknown] = [/FROM bi_lenders l\s+LEFT JOIN bi_lender_login_contacts/, { rows: [{ lender_active: true, contact_active: true }], rowCount: 1 }];

function makeApp() {
  const app = express();
  app.use(express.json());
  // BI_SERVER_v784_STAFF_ONLY_AUTH - lender routes authenticate lenders
  // themselves; the staff-only requireAuth would reject a lender token.
  app.use("/api/v1/lender", biLenderApiRoutes);
  app.use("/api/v1/lender", biLenderApplicationCreate);
  return app;
}
function lenderToken() { return jwt.sign({ kind: "lender", id: "lender-1", user_id: "user-1", lender_id: "lender-1" }, SECRET); }

describe("v258 GET mine", () => {
  beforeEach(() => queryMock.mockReset());
  it("uses join", async () => {
    resetLenderActiveCache();
    queryMock.mockImplementation(answerBySql([ACTIVE_LENDER]));
    await request(makeApp()).get("/api/v1/lender/lender/applications/mine").set("Authorization", `Bearer ${lenderToken()}`);
    const s = String(callsMatching(queryMock, "FROM bi_applications a")[0][0]);
    expect(s).toMatch(/LEFT JOIN bi_companies/i);
    expect(s).not.toMatch(/bi_applications\.company_name|a\.company_name/);
  });
});

describe("v258 lender create sunset", () => {
  beforeEach(() => queryMock.mockReset());
  it("rejects the legacy application shape without writing to the database", async () => {
    resetLenderActiveCache();
    queryMock.mockImplementation(answerBySql([ACTIVE_LENDER], { rows: [{ id: "app-1", application_code: "BI-A1" }] }));
    const r = await request(makeApp()).post("/api/v1/lender/lender/applications").set("Authorization", `Bearer ${lenderToken()}`).send({ company_name: "Acme Inc", contact_name: "Jane Doe", contact_email: "jane@acme.test", contact_phone: "+14165551234" });
    // BI_UNQUARANTINE_FINAL_v1 - this endpoint was sunset. The legacy shape
    // cannot satisfy the v2 validator's 11 declarations, so it returns 410
    // Gone with a migration path rather than 400ing every request.
    expect(r.status).toBe(410);
    expect(r.body).toMatchObject({ error: "legacy_shape_removed" });
    // Only the lender auth lookup ran; nothing was written.
    expect(queryMock.mock.calls.every((c) => /FROM bi_lenders l\s+LEFT JOIN/.test(String(c[0])))).toBe(true);
  });
  it("rejects the legacy shape before looking up an existing company", async () => {
    resetLenderActiveCache();
    queryMock.mockImplementation(answerBySql([ACTIVE_LENDER, ["bi_companies", { rows: [{ id: "co-existing" }] }]], { rows: [{ id: "app-1", application_code: "BI-A1" }] }));
    const r = await request(makeApp()).post("/api/v1/lender/lender/applications").set("Authorization", `Bearer ${lenderToken()}`).send({ company_name: "ACME INC", contact_name: "Jane", contact_email: "j@a.com", contact_phone: "+14165551234" });
    expect(r.status).toBe(410);
    expect(callsMatching(queryMock, "bi_companies")).toHaveLength(0);
    expect(callsMatching(queryMock, "INSERT")).toHaveLength(0);
  });
});
