// BI_SERVER_BLOCK_v370_DEDUPE_LENDER_SUBMIT_v1
// Both lender create routes (portal JWT in biLenderApplicationCreate, API key
// in biLenderApiRoutes) send to the carrier through the single
// submitLenderApplicationToCarrier service, never by calling pgiSubmit
// themselves. Behaviour test (BI_SERVER_v789: rewritten from a source-text test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn(), submit: vi.fn(), pgiSubmit: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.queryMock(...a) } }));
vi.mock("../lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: (...a: unknown[]) => h.submit(...a) }));
vi.mock("../pgiAdapter", () => ({
  pgiSubmit: (...a: unknown[]) => h.pgiSubmit(...a),
  pgiScore: async () => ({ score_id: "S", score: 80, decision: "approve", country: "CA", naics_code: "236220", created_at: "" }),
  pgiUploadDocument: vi.fn(),
}));
vi.mock("../staffNotifyService", () => ({ notifyStaff: async () => undefined }));

import biLenderApplicationCreate from "../../routes/biLenderApplicationCreate";
import biLenderApiRoutes from "../../routes/biLenderApiRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../lenderActiveCache";

const LENDER = "11111111-1111-4111-8111-111111111111";
const KEY = "bk_live_aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb";
const body = {
  company_name: "Co",
  guarantor: { name: "G", dob: "1980-01-01", email: "g@x.test", address: "125 Main St, Calgary, AB T2P 1A1", phone: "+15875550100", q_ca_id_type: "Passport", q_ca_id_number: "P1" },
  business: { country: "CA", province: "AB", address: "125 Main St, Calgary, AB T2P 1A1", naics: "236220", start_date: "2022-05-03" },
  loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Other Secured Loan" },
  declarations: { section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no" },
};
function app() {
  const a = express();
  a.use(express.json());
  a.use(biLenderApplicationCreate);
  a.use("/api/v1", biLenderApiRoutes);
  return a;
}

beforeEach(() => {
  resetLenderActiveCache();
  h.submit.mockReset();
  h.submit.mockResolvedValue({ pgi_application_id: "P1", pgi_status: "received", pgi_error: null, carrier_request_body: {}, carrier_response: {} });
  h.pgiSubmit.mockReset();
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["FROM bi_lender_api_keys WHERE key_hash", (_s: string, p: unknown[]) => (p[0] === crypto.createHash("sha256").update(KEY).digest("hex") ? { rows: [{ lender_id: LENDER, key_prefix: "bk_live_" }] } : { rows: [] })],
    ["INSERT INTO bi_applications", { rows: [{ id: "app-1", application_code: "C1" }] }],
  ]));
});

describe("v370 - one carrier submit service for both routes", () => {
  it("the portal JWT create calls submitLenderApplicationToCarrier", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${signBiToken({ kind: "lender", id: LENDER }, "1h", process.env.JWT_SECRET as string)}`).send(body);
    expect(r.status).toBe(201);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][0]).toMatchObject({ applicationId: "app-1", isDemo: false });
    expect(h.pgiSubmit).not.toHaveBeenCalled();
  });

  it("the API-key create calls submitLenderApplicationToCarrier", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${KEY}`).send(body);
    expect(r.status).toBe(201);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.pgiSubmit).not.toHaveBeenCalled();
  });
});
