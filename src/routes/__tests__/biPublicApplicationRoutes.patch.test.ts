import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../db";
import express from "express";
import request from "supertest";
import router from "../biPublicApplicationRoutes";

const app = express().use(express.json()).use(router);

describe("BI_SERVER_BLOCK_v62 — PATCH /applications/:publicId accepts financial fields", () => {
  beforeEach(() => vi.mocked(pool.query).mockReset());

  it("persists naics_code, formation_date, country, financial fields, pgi_limit", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: "abc", score_decision: "approve" }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const r = await request(app)
      .patch("/applications/038DA9E7")
      .send({
        country: "CA",
        naics_code: "541330",
        formation_date: "2018-04-15",
        loan_amount: 500000,
        pgi_limit: 400000,
        annual_revenue: 2400000,
        ebitda: 360000,
        total_debt: 150000,
        monthly_debt_service: 4200,
        collateral_value: 800000,
        enterprise_value: 3200000,
      });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const updateCall = vi.mocked(pool.query).mock.calls[1]?.[0] as string;
    expect(updateCall).toMatch(/UPDATE bi_applications SET/);
    expect(updateCall).toMatch(/country = \$\d+/);
    expect(updateCall).toMatch(/naics_code = \$\d+/);
    expect(updateCall).toMatch(/loan_amount = \$\d+/);
    expect(updateCall).toMatch(/ebitda = \$\d+/);
  });
});
