// BI_SERVER_BLOCK_v246_BN_OPTIONAL_SUBMIT_v1
// Asserts that the public application submit gate no longer requires
// business_number, but every OTHER previously-required field is still
// enforced. Lender-flow business_number requirement (none today) is
// out of scope.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Minimal pool mock: returns a single application row tweaked per case.
const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
  },
}));

import router from "../biPublicApplicationRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  public_id: "pub_test",
  score_decision: "approve",
  score_stale: false,
  status: "created",
  guarantor_name: "Jane Doe",
  guarantor_email: "jane@example.com",
  guarantor_dob: "1980-01-01",
  guarantor_address: "1 Main St, Toronto",
  guarantor_phone: "+14165551234",
  business_name: "Acme Inc",
  business_address: "2 King St, Toronto",
  entity_type: "Corporation",
  business_number: null, // <-- the field under test
  lender_name: "Test Lender",
  loan_purpose: "Working capital",
  loan_funding_date: "2026-06-01",
  policy_start_date: "2026-06-01",
  bankruptcy_history: false,
  insolvency_history: false,
  judgment_history: false,
  personal_judgments: false,
  business_judgments: false,
  personally_guaranteeing: true,
  consents: {
    electronic_signature: true,
    info_accurate: true,
    business_solvent: true,
    no_undisclosed_events: true,
    data_use: true,
    credit_pull: true,
    coverage_understood: true,
  },
};

describe("BI_SERVER_BLOCK_v246_BN_OPTIONAL_SUBMIT_v1", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("public submit succeeds when business_number is null", async () => {
    queryMock
      // initial SELECT
      .mockResolvedValueOnce({ rows: [baseRow] })
      // status UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(makeApp())
      .post("/applications/pub_test/submit")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "in_progress" });
  });

  it("public submit succeeds when business_number is the empty string", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ ...baseRow, business_number: "" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(makeApp())
      .post("/applications/pub_test/submit")
      .send({});
    expect(res.status).toBe(200);
  });

  it("still rejects when a DIFFERENT required field is missing (regression)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ...baseRow, lender_name: null }],
    });
    const res = await request(makeApp())
      .post("/applications/pub_test/submit")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_fields");
    expect(res.body.fields).toContain("lender_name");
    expect(res.body.fields).not.toContain("business_number");
  });

  it("still rejects when consents are not granted (regression)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ...baseRow, consents: { ...baseRow.consents, credit_pull: false } }],
    });
    const res = await request(makeApp())
      .post("/applications/pub_test/submit")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_consents");
  });
});
