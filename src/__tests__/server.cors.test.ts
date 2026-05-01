// BI_AUDIT_FIX_v58b — pin: the public BI auth/chat/intake mounts must be
// wrapped in biCors so cross-origin browsers can call /api/v1/otp/*.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("BI_AUDIT_FIX_v58b CORS on public mounts", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../server.ts"), "utf8");

  it("biAuthRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*biAuthRoutes\)/);
  });
  it("chatRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*chatRoutes\)/);
  });
  it("intakeRoutes is mounted with biCors", () => {
    expect(file).toMatch(/app\.use\("\/api\/v1",\s*biCors,\s*intakeRoutes\)/);
  });
  it("does NOT mount biAuthRoutes without biCors anywhere", () => {
    // The legacy unprotected mount (no biCors) must be gone.
    expect(file).not.toMatch(/app\.use\("\/api\/v1",\s*biAuthRoutes\)/);
  });
});
