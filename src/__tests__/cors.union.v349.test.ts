// BI_SERVER_BLOCK_v349_PURBECK_ALIGNMENT_v1
// v789: the union is now FIXED_ALLOWED_ORIGINS + CORS_ALLOWED_ORIGINS inside
// src/platform/corsOrigins.ts; this exercises that module instead of a copy
// of the old union logic.
import { describe, it, expect, afterEach } from "vitest";
import { FIXED_ALLOWED_ORIGINS, configuredOrigins, isAllowedOrigin } from "../platform/corsOrigins";

const saved = process.env.CORS_ALLOWED_ORIGINS;
afterEach(() => {
  if (saved === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = saved;
});

describe("CORS UNION (v349)", () => {
  it("env var origins are unioned with the hardcoded list", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://preview-slot.example.com";
    expect(configuredOrigins()).toEqual(["https://preview-slot.example.com"]);
    expect(isAllowedOrigin("https://www.boreal.insure")).toBe(true);
    expect(isAllowedOrigin("https://boreal.insure")).toBe(true);
    expect(isAllowedOrigin("https://staff.boreal.financial")).toBe(true);
    expect(isAllowedOrigin("https://preview-slot.example.com")).toBe(true);
  });

  it("hardcoded origins cannot be deleted by env var omission (regression: 2026-05-25 OTP outage)", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://other.example.com";
    expect(FIXED_ALLOWED_ORIGINS).toContain("https://www.boreal.insure");
    expect(isAllowedOrigin("https://www.boreal.insure")).toBe(true);
    process.env.CORS_ALLOWED_ORIGINS = "";
    expect(isAllowedOrigin("https://www.boreal.insure")).toBe(true);
  });

  it("env entries are exact origins: trailing slashes trimmed, wildcards and paths dropped", () => {
    expect(configuredOrigins(" https://a.example.com/ , https://*.example.com, https://b.example.com/path,https://c.example.com:8443"))
      .toEqual(["https://a.example.com", "https://c.example.com:8443"]);
    process.env.CORS_ALLOWED_ORIGINS = "https://*.azurestaticapps.net";
    expect(isAllowedOrigin("https://anything.azurestaticapps.net")).toBe(false);
  });
});
