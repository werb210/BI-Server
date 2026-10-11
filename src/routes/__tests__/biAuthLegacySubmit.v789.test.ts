// BI_SERVER_v789_LEGACY_SUBMIT_GUARD + BI_SERVER_v789_STAFF_LOGIN_LIMIT
// Behaviour tests for POST /api/v1/bi/application/submit (biAppApplicantRoutes)
// and the staff login limiter (biAuthRoutes public router).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

const submitMock = vi.fn();
const docsReadyMock = vi.fn();
vi.mock("../../services/biPgiSubmissionService", () => ({
  submitApplicationToPGI: (...a: unknown[]) => submitMock(...a),
  assertDocsReadyForCarrier: (...a: unknown[]) => docsReadyMock(...a),
}));

import publicRouter, { biAppApplicantRoutes } from "../biAuthRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { signStaffToken } from "../../platform/auth";

const secret = () => String(process.env.JWT_SECRET);
const OWNER = "+14165550001";
const OTHER = "+14165550002";
const APP_ID = "11111111-1111-4111-8111-111111111111";

const consents = {
  electronic_signature: true, info_accurate: true, business_solvent: true,
  no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true,
};
const goodRow = {
  id: APP_ID, public_id: "ABCDEFGH", status: "in_progress", country: "CA", data: {},
  applicant_phone_e164: OWNER, guarantor_phone: OWNER,
  guarantor_name: "Jane", guarantor_email: "jane@example.com", guarantor_dob: "1980-01-01",
  guarantor_address: "1 Main", business_name: "Acme", business_address: "2 King",
  lender_name: "Bank", loan_funding_date: "2026-06-01", policy_start_date: "2026-06-01",
  personally_guaranteeing: true, consents, loan_amount: 500000, pgi_limit: 400000,
  q_business_province: "ON", q_ca_loan_type: "Commercial Mortgage", formation_date: "2015-01-01",
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", publicRouter);
  a.use("/api/v1/bi", biAppApplicantRoutes);
  return a;
}

function rowsFor(row: Record<string, unknown>) {
  queryMock.mockImplementation(answerBySql([
    [/SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone/, { rows: [row] }],
    [/SELECT \* FROM bi_applications/, { rows: [row] }],
    [/UPDATE bi_applications/, { rows: [row], rowCount: 1 }],
  ]));
}

const body = { applicationId: APP_ID, facilityType: "secured", loanAmount: 500000 };
const applicantToken = (phone: string) => signBiToken({ kind: "applicant", phone }, "1h", secret());
const legacyApplicantToken = (phone: string) =>
  signStaffToken({ staffUserId: "u1", role: "applicant", phone, userType: "applicant" });

describe("POST /api/v1/bi/application/submit - principal and ownership", () => {
  beforeEach(() => {
    queryMock.mockReset();
    submitMock.mockReset().mockResolvedValue({ externalId: "X1", status: "submitted", alreadySubmitted: false });
    docsReadyMock.mockReset().mockResolvedValue({ ready: true });
  });

  it("another applicant's token gets 403 and the carrier is never called", async () => {
    rowsFor(goodRow);
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${applicantToken(OTHER)}`).send(body);
    expect([403, 404]).toContain(res.status);
    expect(res.body.error).toBe("not_owner");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("an unknown application gets 404 for an applicant", async () => {
    queryMock.mockImplementation(answerBySql([]));
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${legacyApplicantToken(OWNER)}`).send(body);
    expect(res.status).toBe(404);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("a lender / referrer token is refused 403", async () => {
    rowsFor(goodRow);
    for (const role of ["lender", "referrer"]) {
      const token = signStaffToken({ staffUserId: "u2", role, phone: OWNER, userType: role });
      const res = await request(app()).post("/api/v1/bi/application/submit")
        .set("Authorization", `Bearer ${token}`).send(body);
      expect(res.status).toBe(403);
    }
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("the owner (new token shape) passes and the carrier is called with the resolved id", async () => {
    rowsFor(goodRow);
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${applicantToken(OWNER)}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data?.success ?? res.body.success).toBe(true);
    expect(submitMock).toHaveBeenCalledWith(APP_ID);
    expect(docsReadyMock).toHaveBeenCalledWith(APP_ID, "2015-01-01");
  });

  it("the owner (legacy /otp/verify token) passes", async () => {
    rowsFor(goodRow);
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${legacyApplicantToken(OWNER)}`).send(body);
    expect(res.status).toBe(200);
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it("a staff token keeps working without an ownership match", async () => {
    rowsFor({ ...goodRow, applicant_phone_e164: OTHER, guarantor_phone: OTHER });
    const token = signStaffToken({ staffUserId: "admin@example.com", role: "staff", userType: "staff" });
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${token}`).send(body);
    expect(res.status).toBe(200);
    expect(submitMock).toHaveBeenCalledWith(APP_ID);
  });
});

describe("POST /api/v1/bi/application/submit - the public submit gates run first", () => {
  beforeEach(() => {
    queryMock.mockReset();
    submitMock.mockReset().mockResolvedValue({ externalId: "X1", status: "submitted", alreadySubmitted: false });
    docsReadyMock.mockReset().mockResolvedValue({ ready: true });
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["missing fields", { lender_name: null }, "missing_fields"],
    ["missing consents", { consents: { ...consents, credit_pull: false } }, "missing_consents"],
    ["Quebec", { q_business_province: "QC" }, "quebec_blocked"],
    ["loan cap", { loan_amount: 1_500_000 }, "loan_amount_over_cap"],
    ["PGI cap", { pgi_limit: 1_200_000 }, "pgi_limit_over_cap"],
    ["loan type", { q_ca_loan_type: "Line of Credit" }, "loan_type_ineligible"],
  ];
  for (const [label, patch, code] of cases) {
    it(`${label} -> 400 ${code}`, async () => {
      rowsFor({ ...goodRow, ...patch });
      const res = await request(app()).post("/api/v1/bi/application/submit")
        .set("Authorization", `Bearer ${applicantToken(OWNER)}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(code);
      expect(submitMock).not.toHaveBeenCalled();
      expect(callsMatching(queryMock, /SET[\s\S]*status='document_review'/)).toHaveLength(0);
    });
  }

  it("documents not ready -> 400 DOCS_NOT_READY with the slots", async () => {
    rowsFor(goodRow);
    docsReadyMock.mockResolvedValue({ ready: false, missing: ["loan_agreement"], rejected: [], pending: [] });
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${applicantToken(OWNER)}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "DOCS_NOT_READY", missing: ["loan_agreement"] });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("a carrier failure answers without the error text", async () => {
    rowsFor(goodRow);
    submitMock.mockRejectedValue(new Error("SECRET upstream body"));
    const res = await request(app()).post("/api/v1/bi/application/submit")
      .set("Authorization", `Bearer ${applicantToken(OWNER)}`).send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
  });
});

describe("POST /api/v1/staff/login - 10 per minute per IP", () => {
  it("answers 429 on the 11th attempt from one IP, other IPs unaffected", async () => {
    const a = app();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await request(a).post("/api/v1/staff/login").set("X-Forwarded-For", "198.51.100.7").send({});
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
    const other = await request(a).post("/api/v1/staff/login").set("X-Forwarded-For", "198.51.100.8").send({});
    expect(other.status).toBe(400);
  });

  it("is attached to the login route only (other /api/v1 paths are not counted)", async () => {
    const a = app();
    a.get("/api/v1/other", (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 15; i++) {
      const r = await request(a).get("/api/v1/other").set("X-Forwarded-For", "198.51.100.9");
      expect(r.status).toBe(200);
    }
  });
});
