// BI_SERVER_PREMIUM_BY_COUNTRY_v1
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { calculatePremium } from "../services/premiumService";
import quoteRoutes from "../routes/biQuoteRoutes";

describe("indicative premium by country", () => {
  it("Canada: 2.7% of the insured amount, 80% of the loan at most, $1,000,000 loan at most", () => {
    expect(calculatePremium({ loanAmount: 500_000, facilityType: "secured" })).toMatchObject({ rate: 0.027, coverageRatio: 0.8, insuredAmount: 400_000, annualPremium: 10_800, monthlyPremium: 900, currency: "CAD", capped: false });
    expect(calculatePremium({ loanAmount: 3_000_000, facilityType: "secured", country: "CA" })).toMatchObject({ loanAmount: 1_000_000, insuredAmount: 800_000, capped: true });
  });
  it("United States: 2%, 90% secured / 70% unsecured, cover capped at $5,000,000", () => {
    expect(calculatePremium({ loanAmount: 2_000_000, facilityType: "secured", country: "US" })).toMatchObject({ rate: 0.02, coverageRatio: 0.9, insuredAmount: 1_800_000, annualPremium: 36_000, monthlyPremium: 3_000, currency: "USD", capped: false });
    expect(calculatePremium({ loanAmount: 2_000_000, facilityType: "unsecured", country: "US" })).toMatchObject({ coverageRatio: 0.7, insuredAmount: 1_400_000, annualPremium: 28_000 });
    expect(calculatePremium({ loanAmount: 10_000_000, facilityType: "secured", country: "US" })).toMatchObject({ insuredAmount: 5_000_000, annualPremium: 100_000, capped: true });
    expect(calculatePremium({ loanAmount: 1_000_000, facilityType: "secured", country: "US", coverage: 0.5 })).toMatchObject({ insuredAmount: 500_000, annualPremium: 10_000 });
  });
  it("the quote route uses the same calculation", async () => {
    const app = express().use(quoteRoutes);
    const us = await request(app).get("/quote/calculate?loan=2000000&coverage=0.9&country=US");
    expect(us.body).toMatchObject({ coverage_amount: 1_800_000, rate: 0.02, annual_premium: 36_000, currency: "USD" });
    const ca = await request(app).get("/quote/calculate?loan=500000&coverage=0.8");
    expect(ca.body).toMatchObject({ coverage_amount: 400_000, rate: 0.027, annual_premium: 10_800, currency: "CAD" });
    expect((await request(app).get("/quote/calculate?loan=0&coverage=0.8")).status).toBe(400);
  });
});
