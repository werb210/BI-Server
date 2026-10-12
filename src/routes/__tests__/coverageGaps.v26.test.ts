// BI_SERVER_v789 [5]/[37] - the biApplicantSubmitRoutes checks are behaviour
// tests now (the real router, ../../db mocked by SQL content).
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { applicantBearer } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import submitRouter from "../biApplicantSubmitRoutes";

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");
const contract = read("src/routes/biApplicantContractRoutes.ts");
const migration = read("src/db/migrations/20260810_bi_coverage_gaps.sql");

describe("coverage gap labels", () => {
  it("labels every extractable coverage", () => {
    for (const code of [
      "cgl", "cpl", "builders_risk", "contractor_equipment", "eo", "cyber", "do",
      "surety_bid", "surety_performance", "surety_payment", "surety_maintenance",
    ]) {
      expect(migration).toContain(`('${code}',`);
    }
  });

  it("uses labels as the baseline and country products as overrides", () => {
    expect(contract).toContain("FROM bi_coverage_labels");
    expect(contract).toContain("for (const row of products.rows) names.set(row.code, row.display_name);");
    expect(migration).toContain("ON CONFLICT (coverage_code) DO UPDATE");
  });
});

describe("unplaceable contract requirements", () => {
  it("records and reports a referral", () => {
    expect(contract).toContain("if (confirmed && !available)");
    expect(contract).toContain("INSERT INTO bi_coverage_gaps");
    expect(contract).toContain("SELECT extracted_limit, limit_basis, clause_text FROM bi_contract_requirements");
    expect(contract).toContain("'coverage_referral_needed'");
    expect(contract).toContain("res.json({ ok: true, available: false, referred: true });");
  });

  it("withdraws referrals and reports availability", () => {
    expect(contract).toContain("DELETE FROM bi_coverage_gaps");
    expect(contract).toContain("available: sellable.has(row.coverage_code)");
    expect(contract).not.toContain("shape(row, names)");
  });
});

describe("coverage gap workflow and review", () => {
  it("supports staff workflow and demand analysis", () => {
    expect(migration).toContain("CHECK (status IN ('open','referred','placed','declined','closed'))");
    expect(migration).toContain("staff_note");
    expect(migration).toContain("idx_bi_gaps_open ON bi_coverage_gaps (status, country, coverage_code)");
    expect(migration).toContain("UNIQUE (application_id, coverage_code)");
  });

  describe("surfaces referrals and allows referral-only submission", () => {
    const PHONE = "+14165550126";
    const app = express().use(express.json()).use("/api/v1", submitRouter);
    const referral = { coverage_code: "cyber", display_name: "Cyber", requested_limit: 1000000, status: "open" };
    const db = (coverages: unknown[], referrals: unknown[]) => queryMock.mockImplementation(answerBySql([
      [/SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone/, {
        rows: [{ id: "app-26", public_id: "PUB26", country: "CA", status: "in_progress", data: {}, applicant_phone_e164: PHONE, guarantor_phone: null }],
      }],
      ["FROM bi_application_products ap JOIN bi_products p", { rows: coverages }],
      ["FROM bi_coverage_gaps g", { rows: referrals }],
      ["COUNT(*)::text AS n", { rows: [{ n: "0" }] }],
      ["SET status = 'ready_for_submission'", { rows: [{ status: "ready_for_submission" }], rowCount: 1 }],
    ]));
    beforeEach(() => queryMock.mockReset());

    it("the summary lists referrals from bi_coverage_gaps and a referral alone makes it submittable", async () => {
      db([], [referral]);
      const r = await request(app).get("/api/v1/applicants/applications/PUB26/summary").set("Authorization", applicantBearer(PHONE));
      expect(r.status).toBe(200);
      expect(r.body.referrals).toEqual([referral]);
      expect(r.body.canSubmit).toBe(true);
      expect(callsMatching(queryMock, "FROM bi_coverage_gaps g")[0][1]).toEqual(["app-26"]);
    });

    it("submits with only a referral", async () => {
      db([], [referral]);
      const r = await request(app).post("/api/v1/applicants/applications/PUB26/submit").set("Authorization", applicantBearer(PHONE)).send({});
      expect(r.status).toBe(200);
      expect(r.body.referrals).toEqual([referral]);
      expect(callsMatching(queryMock, "SET status = 'ready_for_submission'")).toHaveLength(1);
    });

    it("refuses with neither coverage nor referral, and is not submittable", async () => {
      db([], []);
      const s = await request(app).get("/api/v1/applicants/applications/PUB26/summary").set("Authorization", applicantBearer(PHONE));
      expect(s.body.canSubmit).toBe(false);
      const r = await request(app).post("/api/v1/applicants/applications/PUB26/submit").set("Authorization", applicantBearer(PHONE)).send({});
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("no_coverage_selected");
      expect(callsMatching(queryMock, "SET status = 'ready_for_submission'")).toHaveLength(0);
    });
  });
});
