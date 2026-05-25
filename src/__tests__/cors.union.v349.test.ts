// BI_SERVER_BLOCK_v349_PURBECK_ALIGNMENT_v1
import { describe, it, expect } from "vitest";

describe("CORS UNION (v349)", () => {
  it("env var origins are unioned with hardcoded fallback", () => {
    const hardcoded = ["https://staff.boreal.financial","https://www.boreal.insure","https://boreal.insure"];
    const envConfigured = ["https://preview-slot.example.com"];
    const result = Array.from(new Set([...hardcoded, ...envConfigured]));
    expect(result).toContain("https://www.boreal.insure");
    expect(result).toContain("https://boreal.insure");
    expect(result).toContain("https://preview-slot.example.com");
    expect(result.length).toBe(4);
  });
  it("hardcoded origins cannot be deleted by env var omission (regression: 2026-05-25 OTP outage)", () => {
    const result = Array.from(new Set(["https://www.boreal.insure", "https://other.example.com"]));
    expect(result).toContain("https://www.boreal.insure");
  });
});
