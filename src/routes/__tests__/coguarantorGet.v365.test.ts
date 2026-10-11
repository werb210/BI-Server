// BI_SERVER_BLOCK_v365_COGUARANTOR_GET_v1
// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep) of
// GET /api/v1/bi/applications/:id/co-guarantors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import router from "../biApplicationDetailRoutes";
import { answerBySql, callsMatching, rejects, sqlText } from "../../__tests__/helpers/answerBySql";

const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function get(role: string) {
  const a = express();
  a.use((req, _res, next) => { (req as any).user = { role }; next(); });
  a.use("/api/v1/bi/applications", router);
  return request(a).get(`/api/v1/bi/applications/${APP}/co-guarantors`);
}

const ROW = {
  id: "g1", first_name: "Ann", last_name: "Lee", email: "ann@x.test", date_of_birth: "1980-01-01", phone: "+15875550101",
  address: "1 Main", city: "Calgary", province: "AB", postal_code: "T2P1A1", relationship: null, created_at: "2026-01-01",
};

describe("v365 - GET /:id/co-guarantors", () => {
  beforeEach(() => {
    poolQuery.mockReset().mockImplementation(answerBySql([["FROM bi_co_guarantors", { rows: [ROW] }]]));
  });

  it("is staff/admin only", async () => {
    expect((await get("lender")).status).toBe(403);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("queries bi_co_guarantors for the application and returns the fields BF-portal expects", async () => {
    const r = await get("staff");
    expect(r.status).toBe(200);
    expect(r.body.co_guarantors).toEqual([{
      id: "g1", first_name: "Ann", last_name: "Lee", full_name: "Ann Lee", email: "ann@x.test", date_of_birth: "1980-01-01",
      phone: "+15875550101", address: "1 Main", city: "Calgary", province: "AB", postal_code: "T2P1A1", relationship: "Guarantor", created_at: "2026-01-01",
    }]);
    const q = callsMatching(poolQuery, "FROM bi_co_guarantors")[0]!;
    expect(sqlText(q[0])).toMatch(/WHERE application_id = \$1/);
    expect(q[1]).toEqual([APP]);
  });

  it("returns 500 co_guarantor_list_failed on a DB error", async () => {
    poolQuery.mockImplementation(answerBySql([["FROM bi_co_guarantors", rejects(new Error("db down"))]]));
    const r = await get("admin");
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: "co_guarantor_list_failed" });
  });
});
