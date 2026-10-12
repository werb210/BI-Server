// BI_SERVER_BLOCK_v364_REFERRAL_SHORT_CODE_v1
// BI_SERVER_v789 [5]/[37] - the public score checks are behaviour tests now
// (the real biPublicApplicationRoutes router, db mocked by SQL content). Only
// the migration checks still read their .sql file.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { publicIp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiScore: vi.fn().mockResolvedValue({ score_id: "s1", decision: "approve", score: 80 }),
}));

import publicRouter from "../biPublicApplicationRoutes";

const migration = fs.readFileSync(path.resolve(__dirname, "../../db/migrations/2026_05_26_referral_short_code_v364.sql"), "utf8");

describe("v364 - referral short_code migration", () => {
  it("adds short_code column conditionally", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS short_code/);
  });
  it("backfills existing rows from id", () => {
    expect(migration).toMatch(/UPDATE bi_referrals[\s\S]*SET short_code\s*=\s*LOWER\(SUBSTRING/);
  });
  it("creates unique index on short_code", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_referrals_short_code_unique/);
  });
});

describe("v364 - public submit accepts ref AND ref_code (UUID and short)", () => {
  const app = express().use(express.json()).use("/api/v1", publicRouter);
  const core = {
    country: "CA", naics_code: "541330", formation_date: "2018-04-15", loan_amount: 500000, pgi_limit: 400000,
    annual_revenue: 2000000, ebitda: 300000, total_debt: 100000, monthly_debt_service: 4000,
    collateral_value: 800000, enterprise_value: 3000000,
  };
  const score = () => request(app).post("/api/v1/applications/score").set("X-Forwarded-For", publicIp());
  const lookup = () => {
    const q = callsMatching(queryMock, /FROM bi_referrals/)[0];
    expect(q).toBeTruthy();
    return { sql: String(q[0]), params: q[1] as unknown[] };
  };
  beforeEach(() => queryMock.mockReset().mockImplementation(answerBySql([])));

  it("reads ref, ref_code from body + query (in that order)", async () => {
    await score().send({ ...core, ref: "bodyref1", ref_code: "bodycode" });
    expect(lookup().params).toEqual(["bodyref1"]);
    queryMock.mockClear();
    await score().send({ ...core, ref_code: "bodycode" });
    expect(lookup().params).toEqual(["bodycode"]);
    queryMock.mockClear();
    await score().query({ ref: "qref0001", ref_code: "qcode001" }).send(core);
    expect(lookup().params).toEqual(["qref0001"]);
    queryMock.mockClear();
    await score().query({ ref_code: "qcode001" }).send(core);
    expect(lookup().params).toEqual(["qcode001"]);
  });

  it("UUID detection matches the 8-4-4-4-12 hex spec, case-insensitively", async () => {
    const upper = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    await score().send({ ...core, ref: upper });
    expect(lookup().sql).toMatch(/WHERE id = \$1::uuid/);
    expect(lookup().params).toEqual([upper]);
    for (const notUuid of ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee", "gaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "aaaaaaaabbbb4ccc8dddeeeeeeeeeeee"]) {
      queryMock.mockClear();
      await score().send({ ...core, ref: notUuid });
      expect(lookup().sql).toMatch(/WHERE short_code = LOWER\(\$1\)/);
    }
  });

  it("non-UUID path queries by short_code, lowercased", async () => {
    await score().send({ ...core, ref_code: "AB12cd34" });
    const { sql, params } = lookup();
    expect(sql).toMatch(/WHERE short_code = LOWER\(\$1\)/);
    expect(params).toEqual(["AB12cd34"]);
  });
});
