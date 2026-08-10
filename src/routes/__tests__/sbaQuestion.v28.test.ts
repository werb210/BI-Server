// BI_SBA_QUESTION_v28 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (r: string) => readFileSync(path.join(process.cwd(), r), "utf8");
const mig = read("src/db/migrations/20260811_bi_sba_question.sql");
const prior = read("src/db/migrations/20260810_bi_pgi_application_fields.sql");

describe("each country is asked about its own programme", () => {
it("asks US applicants about the SBA", () => {
expect(mig).toContain("Is the loan backed by the U.S. Small Business Administration?");
expect(mig).toContain("('pgi','sba_backed','US',380)");
});
it("keeps CSBFP for Canada only", () => {
expect(prior).toContain("AND question_key = 'csbfp_backed' AND country = 'US'");
});
it("does not ask Canadians about the SBA", () => {
expect(mig).toContain("question_key = 'sba_backed' AND country = 'CA'");
});
it("puts both in the same slot in the flow", () => {
expect(prior).toContain("('csbfp_backed',380)");
expect(mig).toContain(",'US',380)");
});
});

describe("it is safe to re-run", () => {
it("upserts the question and the mapping", () => {
expect(mig).toContain("ON CONFLICT (question_key) DO UPDATE");
expect(mig).toContain("ON CONFLICT (coverage_code, question_key, country) DO UPDATE");
});
it("sorts after the migration that creates the loan group", () => {
expect("20260811_bi_sba_question.sql" > "20260810_bi_pgi_application_fields.sql").toBe(true);
});
});
