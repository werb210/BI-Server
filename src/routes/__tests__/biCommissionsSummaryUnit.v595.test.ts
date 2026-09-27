// BI_SERVER_BLOCK_v595_COMMISSIONS_BY_CURRENCY
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeCommissions } from "../biCommissionRoutes";

describe("BI commissions by currency", () => {
  it("keeps USD and CAD apart, by status and in total", () => {
    const s = summarizeCommissions([
      { status: "estimated", currency: "CAD", annual_premium_amount: "1000", commission_amount: "50" },
      { status: "estimated", currency: "USD", annual_premium_amount: 2000, commission_amount: 100 },
      { status: "paid", currency: "USD", annual_premium_amount: "500.50", commission_amount: "25.03" },
      { status: "paid", currency: "EUR", annual_premium_amount: null, commission_amount: null },
    ]);
    expect(s.byStatus.estimated).toEqual({ CAD: { premium: 1000, commission: 50, count: 1 }, USD: { premium: 2000, commission: 100, count: 1 } });
    expect(s.totals.USD).toEqual({ premium: 2500.5, commission: 125.03, count: 2 });
    expect(s.totals.CAD).toEqual({ premium: 1000, commission: 50, count: 2 });
  });
  it("premium received uses a real status, and reports split by currency", () => {
    const routes = readFileSync("src/routes/biCommissionRoutes.ts", "utf8");
    expect(routes).not.toContain("SET status = 'received'");
    expect(routes).toContain("SET status = 'payable'");
    expect(readFileSync("src/routes/biReportRoutes.ts", "utf8")).toContain("commissionOutstandingByCurrency");
  });
});
