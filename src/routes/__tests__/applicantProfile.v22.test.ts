// BI_CLIENT_PROFILE_v22 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const routes = read("src/routes/biApplicantProfileRoutes.ts");
const server = read("src/server.ts");

describe("step 1 endpoint", () => {
  it("is mounted under /api/v1 behind the BI cors guard", () => {
    expect(routes).toContain('router.post("/applicants/profile", authApplicant');
    expect(server).toContain('app.use("/api/v1", biCors, biApplicantProfileRoutes);');
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
