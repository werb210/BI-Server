// BI_AUDIT_FIX_v58 — pin the userType allowlist on /otp/request.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
describe("BI_AUDIT_FIX_v58 biAuthRoutes userType allowlist", () => {
  const file = fs.readFileSync(path.resolve(__dirname, "../biAuthRoutes.ts"), "utf8");
  it("declares the v58 allowlist constant", () => {
    expect(file).toMatch(/ALLOWED_USER_TYPES_v58\s*=\s*\["applicant",\s*"referrer",\s*"lender"\]/);
  });
});
