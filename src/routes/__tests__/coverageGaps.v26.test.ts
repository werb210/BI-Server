import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");
const contract = read("src/routes/biApplicantContractRoutes.ts");
const submit = read("src/routes/biApplicantSubmitRoutes.ts");
const migration = read("src/db/migrations/20260810_bi_coverage_gaps.sql");

describe("coverage gap labels", () => {
  it("labels every extractable coverage", () => {
    for (const code of [
      "cgl", "cpl", "builders_risk", "contractor_equipment", "eo", "cyber", "do",
      "surety_bid", "surety_performance", "surety_payment", "surety_maintenance",
    ]) {
      expect(migration).toContain(`('${code}',`);
    }
  });

  it("uses labels as the baseline and country products as overrides", () => {
    expect(contract).toContain("FROM bi_coverage_labels");
    expect(contract).toContain("for (const row of products.rows) names.set(row.code, row.display_name);");
    expect(migration).toContain("ON CONFLICT (coverage_code) DO UPDATE");
  });
});

describe("unplaceable contract requirements", () => {
  it("records and reports a referral", () => {
    expect(contract).toContain("if (confirmed && !available)");
    expect(contract).toContain("INSERT INTO bi_coverage_gaps");
    expect(contract).toContain("SELECT extracted_limit, limit_basis, clause_text FROM bi_contract_requirements");
    expect(contract).toContain("'coverage_referral_needed'");
    expect(contract).toContain("res.json({ ok: true, available: false, referred: true });");
  });

  it("withdraws referrals and reports availability", () => {
    expect(contract).toContain("DELETE FROM bi_coverage_gaps");
    expect(contract).toContain("available: sellable.has(row.coverage_code)");
    expect(contract).not.toContain("shape(row, names)");
  });
});

describe("coverage gap workflow and review", () => {
  it("supports staff workflow and demand analysis", () => {
    expect(migration).toContain("CHECK (status IN ('open','referred','placed','declined','closed'))");
    expect(migration).toContain("staff_note");
    expect(migration).toContain("idx_bi_gaps_open ON bi_coverage_gaps (status, country, coverage_code)");
    expect(migration).toContain("UNIQUE (application_id, coverage_code)");
  });

  it("surfaces referrals and allows referral-only submission", () => {
    expect(submit).toContain("referrals: referrals.rows");
    expect(submit).toContain("FROM bi_coverage_gaps g");
    expect(submit).toContain("(coverages.rows.length > 0 || referrals.rows.length > 0) && outstanding.length === 0");
    expect(submit).toContain("summary.coverages.length === 0 && summary.referrals.length === 0");
  });
});
