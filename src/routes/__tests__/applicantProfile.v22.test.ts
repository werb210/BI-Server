// BI_CLIENT_PROFILE_v22 source assertions (no DB required).
// BI_SERVER_v789 [5]/[37] - the server.ts mount check is a behaviour test now:
// it requests the real app (src/server.ts) with ../../db mocked.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { insertColumns } from "../../__tests__/helpers/insertColumns";
import { ALLOWED_ORIGIN, applicantBearer, fromBrowser, realApp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn(answerBySql([]));
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...(a as [])),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...(a as [])), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const routes = read("src/routes/biApplicantProfileRoutes.ts");

describe("step 1 endpoint", () => {
  it("is mounted under /api/v1 behind the BI cors guard", async () => {
    const PHONE = "+14165550122";
    queryMock.mockImplementation(answerBySql([]));
    const app = await realApp();
    const body = { businessName: "Acme", applicantName: "Jane", email: "j@example.com", country: "US", phone: "+14165550999" };
    const r = await fromBrowser(app, "post", "/api/v1/applicants/profile").set("Authorization", applicantBearer(PHONE)).send(body);
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(r.body).toMatchObject({ phone: PHONE, industry: "other", wantsContract: false });
    const [sql, params] = callsMatching(queryMock, "INSERT INTO bi_applications")[0] as [string, unknown[]];
    expect(insertColumns(sql, params).applicant_phone_e164.value).toBe(PHONE);
    // Without a token the same request is refused by the applicant guard.
    expect((await fromBrowser(app, "post", "/api/v1/applicants/profile").send(body)).status).toBe(401);
  });
  it("takes the phone from the token, never from the body", () => {
    expect(routes).toContain("const phone = String(req.applicantPhone);");
    expect(routes).not.toContain("req.body?.phone");
  });
  it("validates the three fields it does accept", () => {
    expect(routes).toContain('"missing_name"');
    expect(routes).toContain('"invalid_email"');
  });
  it("caps field length so a paste bomb cannot land in the row", () => {
    expect(routes).toContain(".slice(0, max)");
  });
});

describe("one in-flight application per applicant", () => {
  it("updates rather than inserting a second", () => {
    expect(routes).toContain("status IN ('created','in_progress')");
    expect(routes).toContain("data = COALESCE(data,'{}'::jsonb) || $3::jsonb");
  });
  it("serves both countries and defaults to CA", () => {
    expect(routes).toContain('COUNTRIES = new Set(["CA", "US"])');
    expect(routes).toContain('return COUNTRIES.has(value) ? (value as "CA" | "US") : "CA";');
  });
});

describe("side effects never fail step 1", () => {
  it("contact sync and activity logging are both catch-guarded", () => {
    expect((routes.match(/\.catch\(\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
