// BI_SERVER_BLOCK_v366_NOTIFICATION_SMS_v2
// BI_SERVER_v789 [5]/[37] - the submit confirmation checks are behaviour tests
// now (the real biPublicApplicationRoutes router, db mocked by SQL content,
// notifyBiClient mocked). The pgiOnApprovedHook checks still read its source.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { publicIp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../pgiAdapter", () => ({ pgiScore: vi.fn() }));
const notifyMock = vi.fn();
vi.mock("../notifyBiClient", () => ({ notifyBiClient: (...a: unknown[]) => notifyMock(...a) }));

import publicRouter from "../../routes/biPublicApplicationRoutes";

const hookSrc = fs.readFileSync(path.resolve(__dirname, "../pgiOnApprovedHook.ts"), "utf8");

describe("v366 - Submit confirmation SMS", () => {
  const app = express().use(express.json()).use("/api/v1", publicRouter);
  const consents = {
    electronic_signature: true, info_accurate: true, business_solvent: true,
    no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true,
  };
  const row = {
    id: "app-366", public_id: "PUB366", score_decision: "approve", status: "created", source: "public",
    guarantor_name: "J", guarantor_email: "j@example.com", guarantor_dob: "1980-01-01", guarantor_address: "a",
    guarantor_phone: "+14165550166", business_name: "B", business_address: "b", lender_name: "L",
    loan_funding_date: "2026-01-01", policy_start_date: "2026-01-01", personally_guaranteeing: true, consents,
    applicant_phone_e164: null as string | null,
  };
  const submit = async (overrides: Partial<typeof row> = {}) => {
    queryMock.mockImplementation(answerBySql([["SELECT * FROM bi_applications WHERE public_id=$1", { rows: [{ ...row, ...overrides }] }]]));
    const r = await request(app).post("/api/v1/applications/PUB366/submit").set("X-Forwarded-For", publicIp()).send({});
    expect(r.status).toBe(200);
    return r;
  };
  beforeEach(() => {
    queryMock.mockReset();
    notifyMock.mockReset().mockResolvedValue({ channel: "sms", sid: "S1" });
  });

  it("goes app first, SMS as fallback (v588)", async () => {
    await submit();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({ applicationId: "app-366", kind: "DOCUMENT_REQUEST" });
    expect(callsMatching(queryMock, "SET status='in_progress'")).toHaveLength(1);
  });
  it("texts the applicant or guarantor phone when the app can't be reached", async () => {
    // v382 widened this guard: applicant_phone_e164 is NULL for virtually
    // every public applicant (the website form collects guarantor_phone).
    await submit();
    expect(notifyMock.mock.calls[0][0].smsTo).toBe("+14165550166");
    notifyMock.mockClear();
    await submit({ applicant_phone_e164: "+14165550111" });
    expect(notifyMock.mock.calls[0][0].smsTo).toBe("+14165550111");
    notifyMock.mockClear();
    // A failed confirmation never fails the submit.
    notifyMock.mockResolvedValue({ channel: "none", error: "twilio" });
    await submit();
  });
  it("includes the docs upload link", async () => {
    await submit();
    expect(notifyMock.mock.calls[0][0].sms).toContain("/applications/PUB366/documents");
  });
});

describe("v366 - Policy.bound SMS in pgiOnApprovedHook", () => {
  it("uses sendOutreachSms", () => {
    expect(hookSrc).toMatch(/sendOutreachSms/);
  });
  it("notifies the applicant", () => {
    expect(hookSrc).toMatch(/APPROVED and bound/);
  });
  it("notifies the referrer when referrer_id is set", () => {
    expect(hookSrc).toMatch(/if \(app\.referrer_id\)/);
    expect(hookSrc).toMatch(/bound a PGI policy/);
  });
  it("each SMS call has its own .catch so failures are isolated", () => {
    expect(hookSrc).toMatch(/applicant bound notice failed/); // BI_SERVER_BLOCK_v588 - app first
    expect(hookSrc).toMatch(/referrer bound SMS failed/);
  });
  it("preserves the existing DB updates from BI_BLOCK_PGI_ALIGNMENT_v1", () => {
    expect(hookSrc).toMatch(/UPDATE bi_referrals SET status='approved'/);
    expect(hookSrc).toMatch(/UPDATE bi_contacts c SET tags/);
  });
});
