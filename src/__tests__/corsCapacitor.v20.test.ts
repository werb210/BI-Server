// BI_SERVER_CORS_CAPACITOR_v20 source assertions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/server.ts"), "utf8");

describe("native BI-Client origins are allowed", () => {
  it("allows the iOS Capacitor WebView origin", () => {
    expect(src).toContain('"capacitor://localhost"');
  });

  it("allows the Android WebView origin", () => {
    expect(src).toContain('"https://localhost"');
  });

  it("puts them in the hardcoded fallback, which the env var can only add to", () => {
    const block = src.slice(
      src.indexOf("const PRODUCTION_FALLBACK_ORIGINS"),
      src.indexOf("const DEV_FALLBACK_ORIGINS"),
    );
    expect(block).toContain("capacitor://localhost");
    expect(block).toContain("https://localhost");
    expect(src).toContain("...baseFallback, ...configuredOrigins");
  });

  it("does not disturb the existing canonical origins", () => {
    for (const origin of [
      "https://client.boreal.insure",
      "https://boreal.insure",
      "https://www.boreal.insure",
      "https://staff.boreal.financial",
    ]) {
      expect(src).toContain(origin);
    }
  });
});
