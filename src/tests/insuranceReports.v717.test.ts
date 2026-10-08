// BI_SERVER_INSURANCE_REPORTS_v717
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

const sqls: string[] = [];
vi.mock("pg", () => {
  class Pool { query = async (sql: string) => { sqls.push(sql); return { rows: sql.includes("bi_referrers") ? [{ label: "Jane Broker", applications: 3, policies: 1, premium: "1200.4", commission: "240" }] : [] }; }; }
  return { Pool, default: { Pool } };
});
import router, { reportDays } from "../routes/biReportRoutes";

describe("Insurance reports", () => {
  it("returns referrers, turnaround and premium for the staff Reports page", async () => {
    const app = express(); app.use("/api/v1/bi", router);
    const r = await request(app).get("/api/v1/bi/reports/insurance?days=90");
    expect(r.status).toBe(200);
    expect(r.body.data.referrers).toEqual([{ label: "Jane Broker", applications: 3, policies: 1, premium: 1200, commission: 240 }]);
    expect(Array.isArray(r.body.data.turnaround)).toBe(true);
    expect(sqls.some((s) => s.includes("event_type IN ('stage_change', 'application_stage_changed')"))).toBe(true);
    expect(sqls.some((s) => s.includes("COALESCE(a.is_demo, false) = false"))).toBe(true);
  });
  it("keeps the period sensible", () => {
    expect(reportDays("30")).toBe(30);
    expect(reportDays("abc")).toBe(365);
    expect(reportDays("99999")).toBe(1095);
  });
});
