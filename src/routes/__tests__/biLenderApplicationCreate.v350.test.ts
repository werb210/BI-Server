// BI_SERVER_BLOCK_v350_LENDER_PURBECK_ALIGNMENT_v1
// Lender portal create: risk booleans are not required, province and
// q_ca_loan_type are, Quebec is blocked, 1M caps on loan amount and PGI limit,
// loan-type allowlist, declarations persisted as JSONB and co-guarantors
// inserted. Behaviour test (BI_SERVER_v789: rewritten from a source-text test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn(), submit: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.queryMock(...a) } }));
vi.mock("../../services/lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: (...a: unknown[]) => h.submit(...a) }));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: async () => undefined }));

import biLenderApplicationCreate from "../biLenderApplicationCreate";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const LENDER = "11111111-1111-4111-8111-111111111111";
function app() {
  const a = express();
  a.use(express.json());
  a.use(biLenderApplicationCreate);
  return a;
}
const auth = () => `Bearer ${signBiToken({ kind: "lender", id: LENDER }, "1h", process.env.JWT_SECRET as string)}`;
function body(over: Record<string, any> = {}) {
  const b: Record<string, any> = {
    company_name: "Co",
    guarantor: { name: "G", phone: "+15875550100", q_ca_id_type: "Passport", q_ca_id_number: "P-1" },
    business: { country: "CA", province: "AB", naics: "236220", start_date: "2022-05-03" },
    loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Commercial Mortgage" },
  };
  for (const [k, v] of Object.entries(over)) b[k] = v && typeof v === "object" && !Array.isArray(v) && b[k] ? { ...b[k], ...v } : v;
  return b;
}
const post = (b: unknown) => request(app()).post("/api/v1/lender/applications").set("Authorization", auth()).send(b as object);

beforeEach(() => {
  resetLenderActiveCache();
  h.submit.mockReset();
  h.submit.mockResolvedValue({ pgi_application_id: "P1", pgi_status: "received", pgi_error: null });
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["INSERT INTO bi_applications", { rows: [{ id: "app-1", application_code: "C1" }] }],
  ]));
});

describe("biLenderApplicationCreate (v350)", () => {
  it("does NOT require bankruptcy / insolvency / judgment history", async () => {
    const r = await post(body());
    expect(r.status).toBe(201);
  });

  it("requires business.province and loan.q_ca_loan_type", async () => {
    const r = await post(body({ business: { province: "" }, loan: { q_ca_loan_type: "" } }));
    expect(r.status).toBe(400);
    expect(r.body.missing).toEqual(expect.arrayContaining(["business.province", "loan.q_ca_loan_type"]));
    expect(r.body.missing).not.toEqual(expect.arrayContaining(["risk.bankruptcy_history"]));
  });

  it("blocks Quebec server-side", async () => {
    const r = await post(body({ business: { province: "QC" } }));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "quebec_blocked", message: "PGI does not currently write business in Quebec." });
  });

  it("1M cap on loan amount and PGI limit", async () => {
    expect((await post(body({ loan: { amount: 1_000_001 } }))).body.error).toBe("loan_amount_over_cap");
    expect((await post(body({ loan: { amount: 1_000_000, pgi_limit: 1_000_001 } }))).body.error).toBe("pgi_limit_over_cap");
  });

  it("loan-type allowlist (Commercial Mortgage / Other Secured Loan only)", async () => {
    expect((await post(body({ loan: { q_ca_loan_type: "Other Secured Loan" } }))).status).toBe(201);
    const r = await post(body({ loan: { q_ca_loan_type: "Unsecured Line" } }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("loan_type_ineligible");
  });

  it("persists declarations to the JSONB column and co-guarantors to their table", async () => {
    const r = await post(body({ declarations: { section_1_a: "no" }, co_guarantors: [{ first_name: "A", last_name: "B" }, { first_name: "Q", last_name: "C", province: "QC" }] }));
    expect(r.status).toBe(201);
    const upd = callsMatching(h.queryMock, "SET declarations = $1::jsonb")[0] as [string, unknown[]];
    expect(JSON.parse(String(upd[1][0]))).toEqual({ section_1_a: "no" });
    expect(upd[1][1]).toBe(true); // has_co_guarantors
    expect(callsMatching(h.queryMock, "INSERT INTO bi_co_guarantors")).toHaveLength(1); // QC co-guarantor skipped
  });
});
