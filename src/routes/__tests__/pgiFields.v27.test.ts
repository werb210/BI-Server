// BI_PGI_FIELDS_v27 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (r: string) => readFileSync(path.join(process.cwd(), r), "utf8");
const mig = read("src/db/migrations/20260810_bi_pgi_application_fields.sql");
const routes = read("src/routes/biApplicantQuestionRoutes.ts");

describe("the bank can now express a non-yes/no field", () => {
  it("adds options, bounds and placeholder idempotently", () => {
    for (const c of ["options     JSONB", "min_value   NUMERIC", "max_value   NUMERIC", "placeholder TEXT"]) expect(mig).toContain(c);
    expect((mig.match(/ADD COLUMN IF NOT EXISTS/g) || []).length).toBe(4);
  });
  it("returns that metadata to the client", () => {
    expect(routes).toContain("q.options, q.min_value, q.max_value, q.placeholder");
    expect(routes).toContain("minValue: row.min_value === null ? null : Number(row.min_value)");
  });
  it("keeps metadata in the GROUP BY", () => {
    expect(routes.slice(routes.indexOf("GROUP BY q.question_key"))).toContain("q.options, q.min_value, q.max_value, q.placeholder");
  });
});

describe("the PGI application fields are seeded", () => {
  it("covers guarantor, business, loan, and guarantee details", () => {
    for (const k of ["guarantor_dob", "guarantor_addr_line1", "guarantor_addr_city", "guarantor_addr_region", "guarantor_addr_postal", "q_ca_id_type", "q_ca_id_number", "entity_type", "business_addr_line1", "business_addr_city", "business_addr_region", "business_addr_postal", "business_number", "business_website", "lender_name", "q_ca_loan_type", "loan_amount", "pgi_limit", "loan_funding_date", "policy_start_date", "loan_purpose", "csbfp_backed", "loan_has_guaranteed_cap", "personally_guaranteeing"]) expect(mig).toContain(`('${k}'`);
  });
  it("does not re-ask fields captured at step 1", () => {
    for (const k of ["'business_name'", "'guarantor_name'", "'guarantor_email'", "'guarantor_phone'"]) expect(mig).not.toContain(k);
  });
  it("carries option lists and numeric bounds", () => {
    expect(mig).toContain('["Passport","National ID","Driving Licence","Other"]');
    expect(mig).toContain('["Corporation","Partnership","Sole Proprietorship","LLC","Other"]');
    expect(mig).toContain('["Commercial Mortgage","Other Secured Loan"]');
    expect(mig).toContain("50000,1000000");
  });
});

describe("ordering and country sensitivity", () => {
  it("moves disclosures and seeds detail in the 100-400 band", () => {
    expect(mig).toContain("UPDATE bi_coverage_questions SET sort_order = sort_order + 1000");
    expect(mig).toContain("group_key IN ('declarations','consents')");
    expect(mig).toContain("('guarantor_dob',110)");
    expect(mig).toContain("('personally_guaranteeing',400)");
    expect(mig).toContain("ON CONFLICT (coverage_code, question_key, country) DO UPDATE\n  SET sort_order = EXCLUDED.sort_order");
  });
  it("does not ask US applicants about CSBFP", () => expect(mig).toContain("AND question_key = 'csbfp_backed' AND country = 'US'"));
});

describe("the seed cannot crash-loop the server", () => {
  it("widens the input_type CHECK before inserting select fields", () => {
    expect(mig.indexOf("bi_questions_input_type_check")).toBeGreaterThan(-1);
    expect(mig.indexOf("bi_questions_input_type_check")).toBeLessThan(mig.indexOf("INSERT INTO bi_questions"));
    expect(mig).toContain("pg_get_constraintdef(oid) ILIKE '%input_type%'");
    expect(mig).toContain("'date','select'));");
  });
});
