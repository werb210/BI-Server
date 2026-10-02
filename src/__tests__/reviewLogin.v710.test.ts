// BI_SERVER_REVIEW_LOGIN_v710
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const sendOtpCalls: string[] = [];
const verifyOtpCalls: string[] = [];
vi.mock("../services/otpService", () => ({
  sendOtpSafe: async (phone: string) => { sendOtpCalls.push(phone); return { ok: true as const }; },
  verifyOtpSafe: async (phone: string, code: string) => { verifyOtpCalls.push(phone); return { ok: true as const, approved: code === "123456" }; },
}));
vi.mock("../db", () => ({
  pool: {
    query: async (sql: string) => {
      if (/INSERT INTO bi_contacts/.test(sql)) return { rows: [{ id: "contact-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  },
}));
vi.mock("../platform/env", () => ({ env: { NODE_ENV: "test", JWT_SECRET: "test-secret-1234567890" } }));

async function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", (await import("../routes/biApplicantOtpRoutes")).default);
  return a;
}

describe("store-review sign-in (Boreal Risk)", () => {
  beforeEach(() => {
    sendOtpCalls.length = 0; verifyOtpCalls.length = 0;
    process.env.REVIEW_LOGIN_PHONE = "+18255550198";
    process.env.REVIEW_LOGIN_CODE = "864213";
  });
  afterEach(() => { delete process.env.REVIEW_LOGIN_PHONE; delete process.env.REVIEW_LOGIN_CODE; });

  it("sends no text to the review number", async () => {
    const r = await request(await app()).post("/api/v1/applicants/otp/start").send({ phone: "(825) 555-0198" });
    expect(r.status).toBe(200);
    expect(sendOtpCalls).toEqual([]);
  });

  it("accepts only the configured code and signs in", async () => {
    const bad = await request(await app()).post("/api/v1/applicants/otp/verify").send({ phone: "+18255550198", code: "000000" });
    expect(bad.status).toBe(401);
    const ok = await request(await app()).post("/api/v1/applicants/otp/verify").send({ phone: "+18255550198", code: "864213" });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe("string");
    expect(verifyOtpCalls).toEqual([]);
  });

  it("is off when the settings are missing", async () => {
    delete process.env.REVIEW_LOGIN_CODE;
    await request(await app()).post("/api/v1/applicants/otp/start").send({ phone: "+18255550198" });
    expect(sendOtpCalls).toEqual(["+18255550198"]);
  });

  it("leaves every other number on normal text codes", async () => {
    await request(await app()).post("/api/v1/applicants/otp/start").send({ phone: "+14035550188" });
    expect(sendOtpCalls).toEqual(["+14035550188"]);
    const r = await request(await app()).post("/api/v1/applicants/otp/verify").send({ phone: "+14035550188", code: "864213" });
    expect(r.status).toBe(401);
  });
});
