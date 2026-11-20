// BI_SERVER_QUICK_APPLY_v1 - the application rebuilt to PGI's new short form.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../services/pgiAdapter", () => ({ pgiScore: vi.fn() }));
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: vi.fn() }) }));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn() }));
const notifyMock = vi.fn();
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: (...a: unknown[]) => notifyMock(...a) }));

import router from "../biPublicApplicationRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { passesScoreGate } from "../../services/biPublicFormGates";

const app = express().use(express.json()).use(router);
let ip = 1;
const xff = () => `198.51.100.${(ip++ % 250) + 1}`;
const token = () => signBiToken({ kind: "applicant", phone: "+14035550101" }, "1h");
const body = {
  loan_amount: 500000, pgi_limit: 400000, loan_type: "secured", country: "CA", company_name: "Acme Ltd.",
  business_address: "1 Main St, Calgary AB", business_number: "", naics_code: "541330", revenue_start: "2018-06",
  lender_name: "ATB", loan_purpose: "Working Capital", pg_signed: false, other_guarantors: false, rate_type: "fixed",
  guarantor_name: "Jane Doe", guarantor_email: "jane@example.com",
};

beforeEach(() => {
  queryMock.mockReset().mockImplementation(answerBySql([]));
  notifyMock.mockReset().mockResolvedValue({ channel: "sms" });
});

describe("POST /applications/quick-apply", () => {
  it("needs the applicant's verified phone", async () => {
    const r = await request(app).post("/applications/quick-apply").set("X-Forwarded-For", xff()).send(body);
    expect(r.status).toBe(401);
    expect(callsMatching(queryMock, /INSERT INTO bi_applications/)).toHaveLength(0);
  });

  it("creates an in-progress application with the verified phone and asks for documents", async () => {
    const r = await request(app).post("/applications/quick-apply").set("X-Forwarded-For", xff()).set("Authorization", `Bearer ${token()}`).send(body);
    expect(r.status).toBe(201);
    expect(r.body.public_id).toMatch(/^[A-Za-z0-9]+$/);
    const ins = callsMatching(queryMock, /INSERT INTO bi_applications/)[0]!;
    const p = ins[1] as unknown[];
    expect(String(ins[0])).toContain("'in_progress'");
    expect(p[2]).toBe("pgi_quick_apply");
    expect(p[5]).toBe("2018-06-01");
    expect(p).toContain("+14035550101");
    expect(JSON.parse(String(p[p.length - 1])).quick_apply.rate_type).toBe("fixed");
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "DOCUMENT_REQUEST", smsTo: "+14035550101" }));
  });

  it("lists every missing answer", async () => {
    const r = await request(app).post("/applications/quick-apply").set("X-Forwarded-For", xff()).set("Authorization", `Bearer ${token()}`).send({ ...body, naics_code: "12", pg_signed: undefined, rate_type: "" });
    expect(r.status).toBe(400);
    expect(r.body.issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(["naics_code", "pg_signed", "rate_type"]));
  });

  it("refuses a guarantee larger than the loan", async () => {
    const r = await request(app).post("/applications/quick-apply").set("X-Forwarded-For", xff()).set("Authorization", `Bearer ${token()}`).send({ ...body, pgi_limit: 600000 });
    expect(r.body.error).toBe("pgi_limit_exceeds_loan");
  });

  it("refuses Quebec businesses", async () => {
    const r = await request(app).post("/applications/quick-apply").set("X-Forwarded-For", xff()).set("Authorization", `Bearer ${token()}`).send({ ...body, business_address: "10 Rue X, Montréal, QC H2X 1Y4" });
    expect(r.body.error).toBe("quebec_not_available");
  });

  it("the documents step is open to these applications without a score", () => {
    expect(passesScoreGate({ source: "pgi_quick_apply", score_decision: null } as any)).toBe(true);
  });
});
