// BI_SERVER_v792_STAFF_AUDIENCE - the staff portal calls BI-Server with
// BF-Server staff access tokens (aud "boreal-staff-portal"). Those must pass;
// tokens for other audiences must still be refused.
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { audienceAllowed, verifyBiToken } from "../platform/serviceTokens";

const SECRET = process.env.JWT_SECRET || "test-shared-secret-min-10";

describe("BF-Server staff tokens on BI-Server", () => {
  it("accepts a token signed exactly like BF-Server signAccessToken", () => {
    const token = jwt.sign({ role: "Admin", sub: "5f0c6d2e-1111-4111-8111-111111111111", tv: 0 }, SECRET, {
      algorithm: "HS256",
      issuer: "boreal-staff-server",
      audience: "boreal-staff-portal",
    });
    const claims = verifyBiToken(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.role).toBe("Admin");
  });

  it("still accepts bi-server and no-audience tokens", () => {
    expect(audienceAllowed({ aud: "bi-server" })).toBe(true);
    expect(audienceAllowed({})).toBe(true);
  });

  it("still refuses tokens meant for another service", () => {
    expect(audienceAllowed({ aud: "bf-server" })).toBe(false);
    expect(audienceAllowed({ aud: ["slf-server"] })).toBe(false);
  });
});
