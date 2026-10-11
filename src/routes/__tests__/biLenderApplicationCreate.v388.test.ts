// BI_SERVER_BLOCK_v388_LENDER_Q_ID_v1 - lender create writes q_ca_id_type /
// q_ca_id_number (COALESCE keeps an existing value when the body omits them).
// Behaviour test (BI_SERVER_v789: rewritten from a source-text test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.queryMock(...a) } }));
vi.mock("../../services/lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: async () => ({ pgi_application_id: null, pgi_status: null, pgi_error: null }) }));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: async () => undefined }));

import biLenderApplicationCreate from "../biLenderApplicationCreate";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const body = (g: Record<string, unknown>) => ({
  company_name: "Co",
  guarantor: { name: "G", phone: "+15875550100", ...g },
  business: { country: "CA", province: "AB", naics: "236220", start_date: "2022-05-03" },
  loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Commercial Mortgage" },
});
async function create(g: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use(biLenderApplicationCreate);
  const token = signBiToken({ kind: "lender", id: "11111111-1111-4111-8111-111111111111" }, "1h", process.env.JWT_SECRET as string);
  return request(a).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token}`).send(body(g));
}

beforeEach(() => {
  resetLenderActiveCache();
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["INSERT INTO bi_applications", { rows: [{ id: "app-1", application_code: "C1" }] }],
  ]));
});

describe("BI_SERVER_BLOCK_v388 - lender create writes q_ca_id_*", () => {
  it("updates q_ca_id_type and q_ca_id_number from the guarantor", async () => {
    expect((await create({ q_ca_id_type: "Passport", q_ca_id_number: " P-9 " })).status).toBe(201);
    const [sql, p] = callsMatching(h.queryMock, "SET declarations")[0] as [string, unknown[]];
    expect(sql).toMatch(/q_ca_id_type = COALESCE\(\$5, q_ca_id_type\)/);
    expect(sql).toMatch(/q_ca_id_number = COALESCE\(\$6, q_ca_id_number\)/);
    expect(p[4]).toBe("Passport");
    expect(p[5]).toBe("P-9");
  });

  it("omitted id fields pass NULL so COALESCE keeps the stored value", async () => {
    await create({});
    const [, p] = callsMatching(h.queryMock, "SET declarations")[0] as [string, unknown[]];
    expect(p[4]).toBeNull();
    expect(p[5]).toBeNull();
  });
});
