// BI_SERVER_BLOCK_v401_OTP_E2E_REGRESSION_TEST_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const sendOtpCalls: string[] = [];
const verifyOtpCalls: Array<{ phone: string; code: string }> = [];

vi.mock("../services/otpService", () => ({
  sendOtp: async (phone: string) => { sendOtpCalls.push(phone); return { sid: "mock", to: phone, status: "pending" }; },
  verifyOtp: async (phone: string, code: string) => { verifyOtpCalls.push({ phone, code }); return code === "123456"; },
  sendOtpSafe: async (phone: string) => { sendOtpCalls.push(phone); return { ok: true as const }; },
  verifyOtpSafe: async (phone: string, code: string) => { verifyOtpCalls.push({ phone, code }); return { ok: true as const, approved: code === "123456" }; },
  sendEmailOtpSafe: async () => ({ ok: true as const }),
  verifyEmailOtpSafe: async (_e: string, code: string) => ({ ok: true as const, approved: code === "123456" }),
}));

let provisionedPhones = new Set<string>();
let provisionedEmails = new Set<string>();

vi.mock("../db", () => ({
  pool: {
    query: async (sql: string, params: any[] = []) => {
      if (/bi_lender_login_contacts[\s\S]*phone_e164\s*=\s*\$1/.test(sql)) {
        return { rows: provisionedPhones.has(params[0]) ? [{ id: "lender-1" }] : [], rowCount: 0 };
      }
      if (/bi_lender_login_contacts[\s\S]*LOWER\(c\.email\)\s*=\s*\$1/.test(sql)) {
        return { rows: provisionedEmails.has(params[0]) ? [{ id: "lender-1" }] : [], rowCount: 0 };
      }
      if (/FROM bi_contacts WHERE phone_e164/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM bi_applications WHERE guarantor_phone/.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO bi_contacts/.test(sql)) return { rows: [{ id: "contact-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  },
}));

vi.mock("../platform/env", () => ({ env: { NODE_ENV: "test", JWT_SECRET: "test-secret-1234567890" } }));

async function buildApp() {
  const app = express();
  app.use(express.json());
  const applicant = (await import("../routes/biApplicantOtpRoutes")).default;
  const lender = (await import("../routes/biLenderApiRoutes")).default;
  app.use("/api/v1", applicant);
  app.use("/api/v1", lender);
  return app;
}

describe("v401 — BI OTP flows end-to-end (post-v399 + v400)", () => {
  beforeEach(() => {
    sendOtpCalls.length = 0;
    verifyOtpCalls.length = 0;
    provisionedPhones = new Set();
    provisionedEmails = new Set();
  });

  describe("PUBLIC applicant (no provisioning gate)", () => {
    it("dispatches SMS for any valid phone", async () => {
      const r = await request(await buildApp()).post("/api/v1/applicants/otp/start").send({ phone: "+17802648467" });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      expect(sendOtpCalls).toEqual(["+17802648467"]);
    });
    it("400s invalid phone, no dispatch", async () => {
      const r = await request(await buildApp()).post("/api/v1/applicants/otp/start").send({ phone: "garbage" });
      expect(r.status).toBe(400);
      expect(sendOtpCalls).toEqual([]);
    });
    it("verify correct code returns a JWT", async () => {
      const r = await request(await buildApp()).post("/api/v1/applicants/otp/verify").send({ phone: "+17802648467", code: "123456" });
      expect(r.status).toBe(200);
      expect(typeof r.body.token).toBe("string");
    });
    it("verify wrong code → 401", async () => {
      const r = await request(await buildApp()).post("/api/v1/applicants/otp/verify").send({ phone: "+17802648467", code: "000000" });
      expect(r.status).toBe(401);
    });
    it("normalizes a 10-digit number to +1...", async () => {
      const r = await request(await buildApp()).post("/api/v1/applicants/otp/start").send({ phone: "7802648467" });
      expect(r.status).toBe(200);
      expect(sendOtpCalls).toEqual(["+17802648467"]);
    });
  });

  describe("LENDER (provisioning-gated, v400)", () => {
    it("PROVISIONED phone → 200 + SMS dispatched", async () => {
      provisionedPhones.add("+17802648467");
      const r = await request(await buildApp()).post("/api/v1/lender/otp/start").send({ phone: "+17802648467" });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, channel: "sms" });
      expect(sendOtpCalls).toEqual(["+17802648467"]);
    });
    it("UNPROVISIONED phone → 404 lender_not_provisioned + NO dispatch", async () => {
      const r = await request(await buildApp()).post("/api/v1/lender/otp/start").send({ phone: "+17802648467" });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "lender_not_provisioned" });
      expect(sendOtpCalls).toEqual([]);
    });
    it("PROVISIONED email → 200 channel:email", async () => {
      provisionedEmails.add("partner@example.com");
      const r = await request(await buildApp()).post("/api/v1/lender/otp/start").send({ email: "partner@example.com", channel: "email" });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, channel: "email" });
    });
    it("UNPROVISIONED email → 404", async () => {
      const r = await request(await buildApp()).post("/api/v1/lender/otp/start").send({ email: "stranger@example.com", channel: "email" });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "lender_not_provisioned" });
    });
    it("400s invalid phone shape", async () => {
      const r = await request(await buildApp()).post("/api/v1/lender/otp/start").send({ phone: "nope" });
      expect(r.status).toBe(400);
      expect(sendOtpCalls).toEqual([]);
    });
  });
});
