// BI_QUESTION_BANK_v24 source assertions (no DB required).
// BI_SERVER_v789 [5]/[37] - the server.ts mount check is a behaviour test now:
// it requests the real app (src/server.ts) with ../../db mocked.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { ALLOWED_ORIGIN, applicantBearer, fromBrowser, realApp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn(answerBySql([]));
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...(a as [])),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...(a as [])), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");
const routes = read("src/routes/biApplicantQuestionRoutes.ts");
const migration = read("src/db/migrations/20260810_bi_question_bank.sql");

describe("question bank schema", () => {
  it("deduplicates questions and application answers by question key", () => {
    expect(migration).toMatch(/question_key\s+TEXT PRIMARY KEY/);
    expect(migration).toContain("PRIMARY KEY (coverage_code, question_key, country)");
    expect(migration).toContain("PRIMARY KEY (application_id, question_key)");
  });

  it("is idempotent and carries question metadata", () => {
    expect((migration.match(/CREATE TABLE IF NOT EXISTS/g) || []).length).toBe(3);
    expect(migration).toContain("ON CONFLICT (question_key) DO UPDATE");
    expect(migration).toContain("ON CONFLICT (coverage_code, question_key, country) DO NOTHING");
    for (const column of ["sort_order", "group_key", "depends_on_key", "depends_on_value", "adverse_answer"]) {
      expect(migration).toContain(column);
    }
    expect(migration).not.toContain("pg_trgm");
  });

  it("seeds declarations, consents, and country-specific regulator wording", () => {
    for (const key of ["section_1_a", "section_1_2", "section_2_a", "section_2_b", "section_2_c",
      "section_2_d", "section_3_a", "section_4_a", "section_5_a", "section_6_a", "section_3_c",
      "electronic_signature", "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood"]) {
      expect(migration).toContain(`'${key}'`);
    }
    expect(migration).toContain("('pgi','section_2_c','CA',50)");
    expect(migration).toContain("('pgi','section_2_c_us','US',50)");
    expect(migration).toContain("Internal Revenue Service");
  });
});

describe("question routes", () => {
  it("computes the coverage union and merges saved answers", () => {
    expect(routes).toContain("FROM bi_application_products ap");
    expect(routes).toContain("JOIN bi_coverage_questions cq");
    expect(routes).toContain("GROUP BY q.question_key");
    expect(routes).toContain("ARRAY_AGG(DISTINCT p.display_name) AS asked_by");
    expect(routes).toContain("LEFT JOIN bi_application_answers a");
    expect(routes).toContain("cq.country = $2");
  });

  it("saves bounded batches transactionally and reports outstanding answers", () => {
    expect(routes).toContain('client.query("BEGIN")');
    expect(routes).toContain('client.query("ROLLBACK")');
    expect(routes).toContain("ON CONFLICT (application_id, question_key)");
    expect(routes).toContain('error?.code === "23503"');
    expect(routes).toContain('"too_many_answers"');
    expect(routes).toContain(".slice(0, 400)");
    expect(routes).toContain(".slice(0, 4000)");
    expect(routes).toContain("question.required && !question.value");
  });

  it("is mounted behind applicant ownership checks", async () => {
    const PHONE = "+14165550124";
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_applications WHERE public_id = $1", { rows: [{ id: "app-24", public_id: "PUB24", country: "CA", applicant_phone_e164: PHONE, guarantor_phone: null }] }],
    ]));
    const app = await realApp();
    const r = await fromBrowser(app, "get", "/api/v1/applicants/applications/PUB24/questions").set("Authorization", applicantBearer(PHONE));
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(r.body).toMatchObject({ applicationId: "PUB24", country: "CA", questions: [] });
    expect(callsMatching(queryMock, "JOIN bi_coverage_questions cq")[0][1]).toEqual(["app-24", "CA"]);
    const other = await fromBrowser(app, "get", "/api/v1/applicants/applications/PUB24/questions").set("Authorization", applicantBearer("+14165550999"));
    expect(other.status).toBe(403);
    expect(other.body.error).toBe("not_owner");
    expect((await fromBrowser(app, "get", "/api/v1/applicants/applications/PUB24/questions")).status).toBe(401);
  });
});
