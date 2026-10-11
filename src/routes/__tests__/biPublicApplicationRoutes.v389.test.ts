// BI_SERVER_BLOCK_v389_PATCH_DERIVE_Q_BUSINESS_PROVINCE_v1
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour:
// PATCH mirrors business_address.province into q_business_province unless the
// body sends q_business_province itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import router from "../biPublicApplicationRoutes";

const app = express().use(express.json()).use(router);
const row = { id: "app-1", score_decision: "approve", source: "public", status: "created", guarantor_phone: null };

function updateCall() {
  const c = callsMatching(queryMock, /UPDATE bi_applications SET/)[0];
  return { sql: String(c?.[0] ?? ""), params: (c?.[1] ?? []) as unknown[] };
}

describe("BI_SERVER_BLOCK_v389 - PATCH derives q_business_province", () => {
  beforeEach(() => {
    queryMock.mockReset().mockImplementation(answerBySql([["FROM bi_applications", { rows: [row] }]]));
  });

  it("mirrors the nested province (upper-cased) into q_business_province", async () => {
    const res = await request(app).patch("/applications/ABCDEFGH").send({ business_address: { line1: "1 King", province: "on" } });
    expect(res.status).toBe(200);
    const { sql, params } = updateCall();
    expect(sql).toMatch(/q_business_province = \$2/);
    expect(params[1]).toBe("ON");
  });

  it("does not derive when q_business_province is sent explicitly", async () => {
    await request(app).patch("/applications/ABCDEFGH").send({ business_address: { province: "ON" }, q_business_province: "BC" });
    const { sql, params } = updateCall();
    expect(sql.match(/q_business_province/g)).toHaveLength(1);
    expect(params).toContain("BC");
    expect(params).not.toContain("ON");
  });

  it("ignores a province that is not a 2-letter code", async () => {
    await request(app).patch("/applications/ABCDEFGH").send({ business_address: { province: "Ontario" } });
    expect(updateCall().sql).not.toMatch(/q_business_province/);
  });
});
