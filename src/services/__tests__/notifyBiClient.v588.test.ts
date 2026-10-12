// BI_SERVER_BLOCK_v588_APP_FIRST
// BI_SERVER_v789 [5]/[37] - "every applicant notice goes through it" was a
// source grep of three files; it now runs each caller (the public submit
// route, the policy-bound hook, the abandoned-application nudge) with the db
// mocked by SQL content and watches notifyBiClient through a pass-through spy.
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";
import { publicIp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../smsService", () => ({ sendOutreachSms: vi.fn(async () => ({ sid: "S-ref" })) }));
vi.mock("../pgiAdapter", () => ({ pgiScore: vi.fn() }));
// Pass-through spy: the unit tests below still run the real implementation.
vi.mock("../notifyBiClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../notifyBiClient")>();
  return { ...real, notifyBiClient: vi.fn(real.notifyBiClient) };
});

import { notifyBiClient, type BiClientNotice } from "../notifyBiClient";
import { onApplicationApproved } from "../pgiOnApprovedHook";
import { runAbandonedNudgeTick } from "../../workers/abandonedApplicationNudge";
import publicRouter from "../../routes/biPublicApplicationRoutes";

const notice: BiClientNotice = { applicationId: "a1", kind: "DOCUMENT_REQUEST", title: "t", body: "b", sms: "text", smsTo: "+15875550100" };

describe("notifyBiClient - app first, SMS fallback", () => {
  it("uses the app when a device takes it, and sends no text", async () => {
    const sms = vi.fn(async () => ({ sid: "S1" }));
    expect(await notifyBiClient(notice, { push: async () => 1, sms })).toEqual({ channel: "push" });
    expect(sms).not.toHaveBeenCalled();
  });
  it("texts when the app can't be reached", async () => {
    const sms = vi.fn(async () => ({ sid: "S1" }));
    expect(await notifyBiClient(notice, { push: async () => 0, sms })).toEqual({ channel: "sms", sid: "S1" });
    expect(sms).toHaveBeenCalledWith("+15875550100", "text");
  });
  it("texts when push itself fails", async () => {
    const sms = vi.fn(async () => ({ sid: "S2" }));
    expect((await notifyBiClient(notice, { push: async () => { throw new Error("apns down"); }, sms })).channel).toBe("sms");
  });
  it("reports - never throws - when there is no app and no phone, or the text fails", async () => {
    expect(await notifyBiClient({ ...notice, smsTo: null }, { push: async () => 0, sms: vi.fn() })).toEqual({ channel: "none", error: "no_phone" });
    expect((await notifyBiClient(notice, { push: async () => 0, sms: async () => { throw new Error("twilio"); } })).channel).toBe("none");
  });
});

describe("every applicant notice goes through notifyBiClient", () => {
  // BI_SERVER_v789 [5]/[37] - biDocumentRoutes (document rejected) and biJobs
  // (docs reminder) are behaviour tests: src/__tests__/carrierWiring.v789.test.ts
  // and src/routes/__tests__/cronColumnFix.v361.test.ts.
  const spy = vi.mocked(notifyBiClient);
  const real = spy.getMockImplementation()!;
  const PHONE = "+14165550188";
  const stub = () => {
    spy.mockClear();
    spy.mockImplementation(async () => ({ channel: "sms", sid: "S1" }));
  };
  afterEach(() => {
    spy.mockImplementation(real);
    queryMock.mockReset();
  });

  it("the public submit route (biPublicApplicationRoutes)", async () => {
    stub();
    const consents = {
      electronic_signature: true, info_accurate: true, business_solvent: true,
      no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true,
    };
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{
      id: "app-588", public_id: "PUB588", score_decision: "approve", status: "created", source: "public",
      guarantor_name: "J", guarantor_email: "j@example.com", guarantor_dob: "1980-01-01", guarantor_address: "a",
      guarantor_phone: PHONE, business_name: "B", business_address: "b", lender_name: "L",
      loan_funding_date: "2026-01-01", policy_start_date: "2026-01-01", personally_guaranteeing: true, consents,
      applicant_phone_e164: null,
    }] }]]));
    const app = express().use(express.json()).use("/api/v1", publicRouter);
    const r = await request(app).post("/api/v1/applications/PUB588/submit").set("X-Forwarded-For", publicIp()).send({});
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ applicationId: "app-588", kind: "DOCUMENT_REQUEST", smsTo: PHONE });
  });

  it("the policy-bound hook (pgiOnApprovedHook)", async () => {
    stub();
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_applications WHERE id = $1", { rows: [{ public_id: "PUB588", applicant_phone_e164: PHONE, business_name: "B", referrer_id: null }] }],
    ]));
    await onApplicationApproved("app-588");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ applicationId: "app-588", kind: "APPLICATION_UPDATE", smsTo: PHONE });
    expect(spy.mock.calls[0][0].sms).toContain("/applications/PUB588");
  });

  it("the abandoned-application nudge (abandonedApplicationNudge)", async () => {
    stub();
    queryMock.mockImplementation(answerBySql([
      ["'abandon_nudge2_sent_at') IS NULL", { rows: [] }],
      ["'abandon_nudge_sent_at') IS NULL", { rows: [{ id: "app-588", public_id: "PUB588", applicant_phone_e164: PHONE }] }],
    ]));
    const r = await runAbandonedNudgeTick();
    expect(r.first).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ applicationId: "app-588", kind: "APPLICATION_UPDATE", smsTo: PHONE });
  });
});
