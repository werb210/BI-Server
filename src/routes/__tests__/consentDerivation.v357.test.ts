// BI_SERVER_BLOCK_v357_CONSENT_DERIVATION_v1
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour.
// The derivation now lives in evaluatePublicSubmitGates (biPublicFormGates),
// which the public submit route calls.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn().mockResolvedValue({ channel: "push" }) }));

import router from "../biPublicApplicationRoutes";
import { evaluatePublicSubmitGates, PUBLIC_SUBMIT_CONSENT_KEYS } from "../../services/biPublicFormGates";

const SEVEN = ["electronic_signature", "info_accurate", "business_solvent", "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood"];
const baseConsents = { electronic_signature: true, no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true };
const row = {
  id: "app-1", public_id: "ABCDEFGH", score_decision: "approve", status: "created", source: "public",
  guarantor_name: "J", guarantor_email: "j@example.com", guarantor_dob: "1980-01-01", guarantor_address: "a",
  guarantor_phone: "+14165551234", business_name: "B", business_address: "b", lender_name: "L",
  loan_funding_date: "2026-01-01", policy_start_date: "2026-01-01", personally_guaranteeing: true,
  consents: baseConsents, declarations: { section_3_c: "Agree", section_6_a: "yes" },
};

describe("v357 - submit derives missing consents from declarations", () => {
  it("info_accurate derived from section_3_c === Agree", () => {
    expect(evaluatePublicSubmitGates(row).consents?.info_accurate).toBe(true);
    const r = evaluatePublicSubmitGates({ ...row, declarations: { section_3_c: "Disagree", section_6_a: "yes" } });
    expect(r).toMatchObject({ ok: false, failure: { error: "missing_consents", fields: ["info_accurate"] } });
  });

  it("business_solvent derived from section_6_a === yes", () => {
    expect(evaluatePublicSubmitGates(row).consents?.business_solvent).toBe(true);
    const r = evaluatePublicSubmitGates({ ...row, declarations: { section_3_c: "Agree", section_6_a: "no" } });
    expect(r).toMatchObject({ ok: false, failure: { error: "missing_consents", fields: ["business_solvent"] } });
  });

  it("an explicit consent is not overridden by the declarations", () => {
    const r = evaluatePublicSubmitGates({ ...row, consents: { ...baseConsents, info_accurate: false }, declarations: { section_3_c: "Agree", section_6_a: "yes" } });
    expect(r).toMatchObject({ ok: false, failure: { error: "missing_consents", fields: ["info_accurate"] } });
  });

  it("the 7-key requirement is still enforced", () => {
    expect([...PUBLIC_SUBMIT_CONSENT_KEYS].sort()).toEqual([...SEVEN].sort());
    for (const k of SEVEN) {
      const consents = { ...baseConsents, info_accurate: true, business_solvent: true, [k]: false };
      const r = evaluatePublicSubmitGates({ ...row, consents });
      expect(r, k).toMatchObject({ ok: false, failure: { error: "missing_consents", fields: [k] } });
    }
  });

  describe("route", () => {
    beforeEach(() => {
      queryMock.mockReset().mockImplementation(answerBySql([["FROM bi_applications", { rows: [row] }]]));
    });
    it("derived consents are persisted back to the row", async () => {
      const res = await request(express().use(express.json()).use(router)).post("/applications/ABCDEFGH/submit").send({});
      expect(res.status).toBe(200);
      const upd = callsMatching(queryMock, /UPDATE bi_applications SET consents = \$1::jsonb/)[0];
      expect(JSON.parse(String((upd[1] as unknown[])[0]))).toMatchObject({ info_accurate: true, business_solvent: true });
    });
  });
});
