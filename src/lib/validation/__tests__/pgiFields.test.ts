import { describe, it, expect } from "vitest";
import { validatePgiSubmission } from "../pgiFields";
const valid = { guarantor_name: "Sarah Chen", guarantor_email: "sarah@example.com", business_name: "Maple Leaf Tech Inc.", lender_name: "RBC", form_data: { country: "CA", naics_code: "541511", formation_date: "2019-03-15", loan_amount: 500000, pgi_limit: 250000, annual_revenue: 2000000, ebitda: 400000, total_debt: 300000, monthly_debt_service: 8000, collateral_value: 600000, enterprise_value: 3000000, bankruptcy_history: false, insolvency_history: false, judgment_history: false } };
describe("BI_PGI_ALIGNMENT_v56 PGI validation", () => { it("accepts a fully valid submission", () => { const r = validatePgiSubmission(valid); expect(r.ok).toBe(true); }); });
