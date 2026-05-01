// BI_HARD_ISOLATION_v59 — pin: every public BI mount must be wrapped in
// biCors. Without this OTP login fails cross-origin from the BI-Website.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("BI_HARD_ISOLATION_v59 CORS on public mounts", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../server.ts"), "utf8");

  it("biAuthRoutes (OTP) is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*biAuthRoutes\)/);
  });
  it("chatRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*chatRoutes\)/);
  });
  it("intakeRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*intakeRoutes\)/);
  });
  it("mayaAnalyticsRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*mayaAnalyticsRoutes\)/);
  });
  it("there is no surviving un-CORSed mount", () => {
    // Specifically catch the legacy mounts that lacked biCors.
    expect(file).not.toMatch(/app\.use\("\/api\/v1",\s*biAuthRoutes\)/);
    expect(file).not.toMatch(/app\.use\("\/api\/v1",\s*chatRoutes\)/);
    expect(file).not.toMatch(/app\.use\("\/api\/v1",\s*intakeRoutes\)/);
    expect(file).not.toMatch(/app\.use\("\/api\/v1",\s*mayaAnalyticsRoutes\)/);
  });
});
