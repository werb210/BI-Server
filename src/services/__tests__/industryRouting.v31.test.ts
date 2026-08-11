// BI_INDUSTRY_ROUTING_v31
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectAnswersToData } from "../applicationPayload";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read("src/db/migrations/20260812_bi_industries.sql");
const profile = read("src/routes/biApplicantProfileRoutes.ts");
const contract = read("src/routes/biApplicantContractRoutes.ts");
const submit = read("src/routes/biApplicantSubmitRoutes.ts");
const mapper = read("src/services/pgiCarrierMapper.ts");

describe("industry decides the path", () => {
  it("only construction asks for a contract", () => {
    expect(migration).toContain("('construction','Construction and trades','236220',TRUE,10)");
    const others = migration.match(/\('(?!construction)[a-z_]+','[^']+','\d{6}',(TRUE|FALSE)/g) ?? [];
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((row) => row.endsWith("FALSE"))).toBe(true);
  });

  it("falls back for an unknown or missing industry", () => {
    expect(profile).toContain('return { code: "other", naics: "561990", wantsContract: false };');
  });

  it("returns routing and records attribution", () => {
    expect(profile).toContain("wantsContract: industry.wantsContract");
    expect(profile).toContain("const source = str(req.body?.src, 60).toLowerCase();");
    expect(profile).toContain("...(source ? { source } : {})");
  });
});

describe("applicant-safe coverage routing", () => {
  it("returns labelled categories without carriers outside construction", () => {
    expect(contract).toContain('kind: "categories"');
    expect(contract).toContain("carrier: null");
    expect(contract).toContain("FROM bi_industry_coverages ic");
    expect(contract).toContain("LEFT JOIN bi_coverage_labels l ON l.coverage_code = ic.coverage_code");
  });

  it("keeps the construction product book", () => {
    expect(contract).toContain("industry = 'construction' AND active = TRUE");
    expect(contract).toContain('kind: "products"');
  });

  it("leads each non-construction industry with PGI", () => {
    const rows = migration.split("INSERT INTO bi_industry_coverages")[1] ?? "";
    const industries = [...new Set([...rows.matchAll(/\('([a-z_]+)','[a-z_]+',\d+\)/g)].map((match) => match[1]))];
    expect(industries.length).toBeGreaterThan(5);
    for (const industry of industries) expect(rows).toContain(`('${industry}','pgi',5)`);
  });
});

describe("carrier payload projection", () => {
  it("flattens address components", () => {
    const data = projectAnswersToData([
      { question_key: "guarantor_addr_line1", value: "123 King Street West" },
      { question_key: "guarantor_addr_city", value: "Toronto" },
      { question_key: "guarantor_addr_region", value: "ON" },
      { question_key: "guarantor_addr_postal", value: "M5H 1A1" },
    ]);
    expect(data.guarantor_address).toBe("123 King Street West, Toronto, ON, M5H 1A1");
    expect(mapper).toContain('get("q5_residential_address", "guarantor_address")');
  });

  it("carries NAICS and formation date while dropping blanks and declaration keys", () => {
    const data = projectAnswersToData([
      { question_key: "naics_code", value: "236220" },
      { question_key: "formation_date", value: "2019-04-01" },
      { question_key: "lender_name", value: "  " },
      { question_key: "section_2_a", value: "yes" },
    ]);
    expect(data).toMatchObject({ naics_code: "236220", formation_date: "2019-04-01" });
    expect(data.lender_name).toBeUndefined();
    expect(data.section_2_a).toBeUndefined();
    expect(mapper).toContain('get("q25_naics_code", "naics_code")');
    expect(mapper).toContain('get("q26_formation_date", "formation_date")');
  });

  it("projects before submission status changes", () => {
    expect(submit.indexOf("projectAnswersToData(answered.rows)")).toBeGreaterThan(-1);
    expect(submit.indexOf("SET status = 'ready_for_submission'")).toBeGreaterThan(
      submit.indexOf("projectAnswersToData(answered.rows)"),
    );
  });
});

describe("new PGI questions", () => {
  it("asks formation date and permits overriding the industry NAICS default", () => {
    expect(migration).toContain("('formation_date','When was the business formed?'");
    expect(migration).toMatch(/'naics_code','Industry code',[^\n]*'text','business',FALSE/);
    expect(migration).toContain("('formation_date',115),('naics_code',116)");
  });
});
