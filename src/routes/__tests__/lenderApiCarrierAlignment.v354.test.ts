// BI_SERVER_BLOCK_v354_LENDER_API_CARRIER_ALIGNMENT_v1
// Lender Direct API: nested v2 body validated with validatePgiSubmissionV2,
// legacy flat body rejected (410), doc-type allowlist on uploads, nested
// co-guarantors persisted; the portal create hands the carrier the v2 fields.
// Behaviour test (BI_SERVER_v789: rewritten from a source-text test). Also
// carries the lender-route intents of v362 (410 + docs links, no Deprecation
// header) and v261/v262 (portal INSERT writes source_type='lender').
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn(), submit: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.queryMock(...a) } }));
vi.mock("../../services/lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: (...a: unknown[]) => h.submit(...a) }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiScore: async () => ({ score_id: "S", score: 80, decision: "approve", country: "CA", naics_code: "236220", created_at: "" }),
  pgiSubmit: vi.fn(),
  pgiUploadDocument: vi.fn(),
}));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: async () => undefined }));
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: vi.fn() }) }));

import biLenderApplicationCreate from "../biLenderApplicationCreate";
import biLenderApiRoutes from "../biLenderApiRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const LENDER = "11111111-1111-4111-8111-111111111111";
const KEY = "bk_live_aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb";
const keyAuth = `Bearer ${KEY}`;
const jwtAuth = () => `Bearer ${signBiToken({ kind: "lender", id: LENDER }, "1h", process.env.JWT_SECRET as string)}`;
function app() {
  const a = express();
  a.use(express.json());
  a.use(biLenderApplicationCreate);
  a.use("/api/v1", biLenderApiRoutes);
  return a;
}
function v2(over: Record<string, unknown> = {}) {
  return {
    company_name: "Co",
    guarantor: { name: "G", dob: "1980-01-01", email: "g@x.test", address: "125 Main St, Calgary, AB T2P 1A1", phone: "+15875550100", q_ca_id_type: "Passport", q_ca_id_number: "P1" },
    business: { country: "CA", province: "AB", address: "125 Main St, Calgary, AB T2P 1A1", naics: "236220", start_date: "2022-05-03" },
    loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Other Secured Loan" },
    declarations: { section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no" },
    ...over,
  };
}

beforeEach(() => {
  resetLenderActiveCache();
  h.submit.mockReset();
  h.submit.mockResolvedValue({ pgi_application_id: "P1", pgi_status: "received", pgi_error: null });
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["FROM bi_lender_api_keys WHERE key_hash", (_s: string, p: unknown[]) => (p[0] === crypto.createHash("sha256").update(KEY).digest("hex") ? { rows: [{ lender_id: LENDER, key_prefix: "bk_live_" }] } : { rows: [] })],
    ["INSERT INTO bi_applications", { rows: [{ id: "app-1", application_code: "C1" }] }],
  ]));
});

describe("v354 - Lender Direct API accepts the nested v2 shape", () => {
  it("a valid nested body creates (validatePgiSubmissionV2 passes)", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", keyAuth).send(v2());
    expect(r.status).toBe(201);
    const insert = callsMatching(h.queryMock, "INSERT INTO bi_applications")[0] as [string, unknown[]];
    expect(insert[1][3]).toBe("G"); // guarantor_name mapped from the nested body
  });

  it("an invalid nested body answers 400 validation_failed with issues", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", keyAuth).send(v2({ guarantor: { name: "G", phone: "+15875550100" } }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
    expect(r.body.issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(["form_data.q4_date_of_birth"]));
  });

  it("v362: legacy flat shape answers 410 with migration links and no Deprecation/Sunset header", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", keyAuth).send({ company_name: "Co", loan_amount: 1 });
    expect(r.status).toBe(410);
    expect(r.body.error).toBe("legacy_shape_removed");
    expect(r.body.docs).toMatch(/boreal\.insure\/lender\/api/);
    expect(r.body.openapi).toMatch(/openapi\.json$/);
    expect(r.headers.deprecation).toBeUndefined();
    expect(r.headers.sunset).toBeUndefined();
    expect(callsMatching(h.queryMock, "INSERT")).toHaveLength(0);
  });

  it("co-guarantors in the nested body are inserted", async () => {
    await request(app()).post("/api/v1/lender/applications").set("Authorization", keyAuth).send(v2({ co_guarantors: [{ first_name: "A", last_name: "B" }] }));
    expect(callsMatching(h.queryMock, "INSERT INTO bi_co_guarantors")).toHaveLength(1);
  });
});

describe("v354 - doc-type allowlist on lender API uploads", () => {
  it("returns 400 invalid_doc_type with exactly the 7 carrier types", async () => {
    const r = await request(app()).post("/api/v1/lender/applications/C1/documents").set("Authorization", keyAuth).field("doc_types", "guarantor_id").attach("files", Buffer.from("%PDF-1.4"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_doc_type");
    expect([...r.body.allowed].sort()).toEqual(["ap_aging", "ar_aging", "balance_sheet", "financial_forecast", "founder_cv", "loan_agreement", "profit_loss"]);
  });
});

describe("v354 / v261 / v262 - portal create", () => {
  it("hands the carrier service the v2 carrier fields and inserts source_type='lender'", async () => {
    const r = await request(app()).post("/api/v1/lender/applications").set("Authorization", jwtAuth()).send(v2());
    expect(r.status).toBe(201);
    const snap = h.submit.mock.calls[0][0].rowSnapshot;
    for (const k of ["q4_date_of_birth", "q5_residential_address", "q_ca_id_type", "q_ca_id_number", "q17_business_operating_address", "q_ca_loan_type"]) {
      expect(snap[k], k).toBeTruthy();
    }
    const [sql] = callsMatching(h.queryMock, "INSERT INTO bi_applications")[0] as [string];
    expect(sql).toMatch(/\(entity_type, source, source_type,/);
    expect(sql).toMatch(/VALUES \('applicant', 'lender', 'lender'/);
  });
});
