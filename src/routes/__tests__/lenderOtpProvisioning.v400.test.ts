// BI_SERVER_BLOCK_v400_LENDER_OTP_PROVISIONING_404_v1
// /lender/otp/start answers 404 lender_not_provisioned for an unknown phone or
// email and sends nothing; a provisioned identifier gets its code.
// Behaviour test (BI_SERVER_v789: rewritten from a source-text test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn(), sendSms: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.queryMock(...a) } }));
vi.mock("../../services/otpService", () => ({
  sendOtpSafe: (...a: unknown[]) => h.sendSms(...a),
  sendEmailOtpSafe: (...a: unknown[]) => h.sendEmail(...a),
  verifyOtpSafe: vi.fn(),
  verifyEmailOtpSafe: vi.fn(),
  otpSendFailed: (res: any) => res.status(502).json({ error: "otp_send_failed" }),
}));

import biLenderApiRoutes from "../biLenderApiRoutes";

let provisioned = false;
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", biLenderApiRoutes);
  return a;
}
beforeEach(() => {
  provisioned = false;
  h.sendSms.mockReset();
  h.sendSms.mockResolvedValue({ ok: true });
  h.sendEmail.mockReset();
  h.sendEmail.mockResolvedValue({ ok: true });
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    ["FROM bi_lender_login_contacts", () => ({ rows: provisioned ? [{ id: "c-1" }] : [], rowCount: provisioned ? 1 : 0 })],
  ]));
});

describe("v400 - /lender/otp/start surfaces lender_not_provisioned", () => {
  it("unprovisioned SMS identifier: 404, no SMS sent", async () => {
    const r = await request(app()).post("/api/v1/lender/otp/start").send({ phone: "+14035550188" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "lender_not_provisioned" });
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("unprovisioned email identifier: 404, no email sent", async () => {
    const r = await request(app()).post("/api/v1/lender/otp/start").send({ email: "who@example.com", channel: "email" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "lender_not_provisioned" });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("provisioned identifiers get a code (the send is not swallowed)", async () => {
    provisioned = true;
    const sms = await request(app()).post("/api/v1/lender/otp/start").send({ phone: "+14035550188" });
    expect(sms.status).toBe(200);
    expect(h.sendSms).toHaveBeenCalledWith("+14035550188");
    const email = await request(app()).post("/api/v1/lender/otp/start").send({ email: "who@example.com", channel: "email" });
    expect(email.status).toBe(200);
    expect(h.sendEmail).toHaveBeenCalledWith("who@example.com");
  });
});
