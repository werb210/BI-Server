// BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour:
// POST /applications/score attributes a valid referral (body ref or ?ref=),
// stores referrer_id + referral_id on the application and back-links the
// referral.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiScore: vi.fn().mockResolvedValue({ score_id: "s1", decision: "approve", score: 80 }),
}));

import router from "../biPublicApplicationRoutes";

const app = express().use(express.json()).use(router);
const REF_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const core = {
  country: "CA", naics_code: "541330", formation_date: "2018-04-15", loan_amount: 500000, pgi_limit: 400000,
  annual_revenue: 2000000, ebitda: 300000, total_debt: 100000, monthly_debt_service: 4000,
  collateral_value: 800000, enterprise_value: 3000000,
};
let ip = 1;

function referralRow(phone: string | null) {
  return { id: REF_ID, referrer_id: "referrer-1", status: "invited", email: null, phone_e164: phone };
}

function insertParams() {
  const c = callsMatching(queryMock, /INSERT INTO bi_applications/)[0];
  expect(String(c[0])).toMatch(/referrer_id, referral_id/);
  const p = c[1] as unknown[];
  return { appId: p[0], referrerId: p[14], referralId: p[15] };
}

describe("v360 - public application captures referrer attribution", () => {
  beforeEach(() => queryMock.mockReset());

  it("body ref: validated against bi_referrals (unattached only), stored and back-linked", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_referrals", { rows: [referralRow(null)] }]]));
    const res = await request(app).post("/applications/score").set("X-Forwarded-For", `203.0.113.${ip++}`).send({ ...core, ref: REF_ID });
    expect(res.status).toBe(201);
    const lookup = callsMatching(queryMock, /FROM bi_referrals/)[0];
    expect(String(lookup[0])).toMatch(/application_id IS NULL/);
    const { appId, referrerId, referralId } = insertParams();
    expect(referrerId).toBe("referrer-1");
    expect(referralId).toBe(REF_ID);
    const back = callsMatching(queryMock, /UPDATE bi_referrals/)[0];
    expect(String(back[0])).toMatch(/SET application_id = \$1/);
    expect(String(back[0])).toMatch(/WHEN status = 'invited' THEN 'applied'/);
    expect(back[1]).toEqual([appId, REF_ID]);
  });

  it("?ref= query works the same", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_referrals", { rows: [referralRow(null)] }]]));
    await request(app).post(`/applications/score?ref=${REF_ID}`).set("X-Forwarded-For", `203.0.113.${ip++}`).send(core);
    expect(insertParams().referralId).toBe(REF_ID);
  });

  it("soft phone match: a referral for another phone is not attributed", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_referrals", { rows: [referralRow("+14165550000")] }]]));
    await request(app).post("/applications/score").set("X-Forwarded-For", `203.0.113.${ip++}`)
      .send({ ...core, ref: REF_ID, applicant_phone_e164: "+14165559999" });
    const { referrerId, referralId } = insertParams();
    expect(referrerId).toBeNull();
    expect(referralId).toBeNull();
    expect(callsMatching(queryMock, /UPDATE bi_referrals/)).toHaveLength(0);
  });
});
