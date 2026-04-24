import test from "node:test";
import assert from "node:assert/strict";

import { buildPGIPayload, submitToPGI } from "../services/pgiAdapter";

test("submitToPGI maps BI schema to PGI payload", async () => {
  let capturedPath = "";
  let capturedPayload: unknown;

  const mockClient = {
    post: async (path: string, payload: unknown) => {
      capturedPath = path;
      capturedPayload = payload;
      return { data: { id: "pgi-123", status: "submitted" } };
    }
  };

  const app = {
    id: "app-1",
    businessName: "Acme Inc",
    registrationNumber: "REG-1",
    industry: "Construction",
    firstName: "Sam",
    lastName: "Lee",
    email: "sam@example.com",
    phone: "1234567890",
    loanAmount: 125000,
    loanType: "secured" as const,
    lender: "Lender A",
    coveragePercent: 80,
    scoringAnswers: {
      country: "US",
      naics_code: "236220",
      formation_date: "2018-01-01",
      pgi_limit: 100000,
      annual_revenue: 800000,
      ebitda: 150000,
      total_debt: 300000,
      monthly_debt_service: 7000,
      collateral_value: 250000,
      enterprise_value: 1000000
    },
    documents: [{ type: "bank_statement", base64: "ZmFrZQ==" }]
  };

  const payload = buildPGIPayload(app);
  assert.equal(payload.form_data.loan_amount, 125000);
  assert.equal(payload.form_data.pgi_limit, 100000);
  assert.equal(payload.form_data.country, "US");

  const response = await submitToPGI(app, mockClient as never);

  assert.equal(capturedPath, "/applications/");
  assert.deepEqual(capturedPayload, payload);
  assert.deepEqual(response, { externalId: "pgi-123", status: "submitted" });
});
