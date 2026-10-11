// BI_AUDIT_FIX_v58 - the userType allowlist on /otp/request.
// Rewritten (v789, audit [5]/[37]) from a source-text assertion to behaviour.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const sendOtp = vi.fn();
vi.mock("../../services/otpService", () => ({
  sendOtpSafe: (...a: unknown[]) => sendOtp(...a),
  verifyOtpSafe: vi.fn(),
  otpSendFailed: (res: any) => res.status(502).json({ error: "otp_send_failed" }),
}));

import router from "../biAuthRoutes";

const app = express().use(express.json()).use("/api/v1", router);
const body = (userType?: unknown) => ({ phone: "+14165551234", name: "N", email: "n@example.com", ...(userType === undefined ? {} : { userType }) });

describe("BI_AUDIT_FIX_v58 biAuthRoutes userType allowlist", () => {
  beforeEach(() => {
    queryMock.mockReset().mockImplementation(answerBySql([["COUNT(*)", { rows: [{ n: 0 }] }]]));
    sendOtp.mockReset().mockResolvedValue({ ok: true });
  });

  for (const t of ["applicant", "referrer", "lender", undefined]) {
    it(`accepts ${String(t)}`, async () => {
      const res = await request(app).post("/api/v1/otp/request").send(body(t));
      expect(res.status).toBe(200);
      expect(sendOtp).toHaveBeenCalledTimes(1);
    });
  }

  for (const t of ["staff", "admin", "owner"]) {
    it(`refuses ${t} before any OTP is sent`, async () => {
      const res = await request(app).post("/api/v1/otp/request").send(body(t));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid userType");
      expect(sendOtp).not.toHaveBeenCalled();
    });
  }
});
