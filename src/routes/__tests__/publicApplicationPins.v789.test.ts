// BI_SERVER_v789 (audit [5]/[37]) - behaviour versions of the source-text pins
// that mixed test files (referralShortCode.v364, referralFromBf.v1,
// docUnique.v371, notificationSms.v366, notifyBiClient.v588) keep on
// biPublicApplicationRoutes.ts. Once those files drop their
// readFileSync("...biPublicApplicationRoutes.ts") blocks, these cover the intent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiScore: vi.fn().mockResolvedValue({ score_id: "s1", decision: "approve", score: 80 }),
}));
const putMock = vi.fn();
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: (...a: unknown[]) => putMock(...a) }) }));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn().mockResolvedValue(undefined) }));
const notifyMock = vi.fn();
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: (...a: unknown[]) => notifyMock(...a) }));

import router from "../biPublicApplicationRoutes";

const app = express().use(express.json()).use(router);
let ip = 1;
const xff = () => `203.0.113.${(ip++ % 250) + 1}`;
const core = {
  country: "CA", naics_code: "541330", formation_date: "2018-04-15", loan_amount: 500000, pgi_limit: 400000,
  annual_revenue: 2000000, ebitda: 300000, total_debt: 100000, monthly_debt_service: 4000,
  collateral_value: 800000, enterprise_value: 3000000,
};

beforeEach(() => {
  queryMock.mockReset().mockImplementation(answerBySql([]));
  putMock.mockReset().mockResolvedValue({ blobName: "b", url: "u", hash: "h", sizeBytes: 1 });
  notifyMock.mockReset().mockResolvedValue({ channel: "sms" });
});

describe("v364 - score accepts ref and ref_code (UUID and short code)", () => {
  it("a UUID ref is looked up by id", async () => {
    const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await request(app).post("/applications/score").set("X-Forwarded-For", xff()).send({ ...core, ref: uuid });
    const q = callsMatching(queryMock, /FROM bi_referrals/)[0];
    expect(String(q[0])).toMatch(/WHERE id = \$1::uuid/);
    expect(q[1]).toEqual([uuid]);
  });

  for (const [label, send] of [
    ["body ref_code", (r: request.Test) => r.send({ ...core, ref_code: "AB12cd34" })],
    ["?ref_code= query", (r: request.Test) => r.query({ ref_code: "AB12cd34" }).send(core)],
  ] as const) {
    it(`${label} is looked up by short_code, lower-cased in SQL`, async () => {
      await send(request(app).post("/applications/score").set("X-Forwarded-For", xff()));
      const q = callsMatching(queryMock, /FROM bi_referrals/)[0];
      expect(String(q[0])).toMatch(/WHERE short_code = LOWER\(\$1\)/);
      expect(q[1]).toEqual(["AB12cd34"]);
    });
  }
});

describe("BI_SERVER_REFERRAL_FROM_BF_v1 - raw referral code persisted at create", () => {
  it("writes referrer_code when the application has none", async () => {
    await request(app).post("/applications/score").set("X-Forwarded-For", xff()).send({ ...core, ref_code: "bfcode1" });
    const upd = callsMatching(queryMock, /SET referrer_code = \$1/)[0];
    expect(upd).toBeTruthy();
    expect((upd[1] as unknown[])[0]).toBe("bfcode1");
    expect(String(upd[0])).toMatch(/referrer_code IS NULL OR referrer_code = ''/);
  });
});

describe("v371 - public re-upload replaces the slot and resets carrier forwarding", () => {
  it("INSERT ... ON CONFLICT (application_id, doc_type) WHERE purged_at IS NULL DO UPDATE", async () => {
    queryMock.mockImplementation(answerBySql([
      ["SELECT id, score_decision, status, source FROM bi_applications", { rows: [{ id: "app-1", score_decision: "approve", status: "document_review" }] }],
      ["INSERT INTO bi_documents", { rows: [{ id: "doc-1" }] }],
    ]));
    const res = await request(app).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", xff())
      .field("doc_types", "profit_loss").attach("files", Buffer.from("%PDF-1.4\n"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    const sql = String(callsMatching(queryMock, "INSERT INTO bi_documents")[0][0]);
    expect(sql).toMatch(/ON CONFLICT \(application_id, doc_type\) WHERE purged_at IS NULL/);
    expect(sql).toMatch(/pgi_document_id = NULL/);
    expect(sql).toMatch(/forwarded_to_carrier_at = NULL/);
  });
});

describe("v366 / v588 - submit confirmation goes app first, SMS fallback", () => {
  const consents = {
    electronic_signature: true, info_accurate: true, business_solvent: true,
    no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true,
  };
  const row = {
    id: "app-1", public_id: "PUBX1234", score_decision: "approve", status: "created", source: "public",
    guarantor_name: "J", guarantor_email: "j@example.com", guarantor_dob: "1980-01-01", guarantor_address: "a",
    guarantor_phone: "+14165550199", business_name: "B", business_address: "b", lender_name: "L",
    loan_funding_date: "2026-01-01", policy_start_date: "2026-01-01", personally_guaranteeing: true, consents,
    applicant_phone_e164: null,
  };

  it("texts the guarantor phone when applicant_phone_e164 is empty, with the documents link", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [row] }]]));
    const res = await request(app).post("/applications/PUBX1234/submit").set("X-Forwarded-For", xff()).send({});
    expect(res.status).toBe(200);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const notice = notifyMock.mock.calls[0][0];
    expect(notice).toMatchObject({ applicationId: "app-1", kind: "DOCUMENT_REQUEST", smsTo: "+14165550199" });
    expect(notice.sms).toContain("/applications/PUBX1234/documents");
  });

  it("prefers applicant_phone_e164 when present", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...row, applicant_phone_e164: "+14165550111" }] }]]));
    await request(app).post("/applications/PUBX1234/submit").set("X-Forwarded-For", xff()).send({});
    expect(notifyMock.mock.calls[0][0].smsTo).toBe("+14165550111");
  });
});
