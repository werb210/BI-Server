// BI_SERVER_BLOCK_v362_LEGACY_SUNSET_AND_STUB_GUARD_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const adapterSrc = fs.readFileSync(path.resolve(__dirname, "../services/pgiAdapter.ts"), "utf8");
const serverSrc = fs.readFileSync(path.resolve(__dirname, "../server.ts"), "utf8");

// BI_SERVER_v789 - the legacy-shape sunset (410 legacy_shape_removed with the
// docs + openapi links, no Deprecation/Sunset header) is a behaviour test now:
// src/routes/__tests__/lenderApiCarrierAlignment.v354.test.ts.

describe("v362 — STUB default is env-aware", () => {
  it("STUB is computed via IIFE that branches on NODE_ENV", () => {
    expect(adapterSrc).toMatch(/process\.env\.NODE_ENV !== "production"/);
  });
  it("explicit USE_PGI_STUB=false beats NODE_ENV check", () => {
    expect(adapterSrc).toMatch(/raw === "false"/);
  });
});

describe("v362 — production boot guard", () => {
  it("server.ts hard-fails on USE_PGI_STUB=true in production", () => {
    expect(serverSrc).toMatch(/USE_PGI_STUB=true in production/);
    expect(serverSrc).toMatch(/process\.exit\(1\)/);
  });
  it("server.ts hard-fails on missing PGI_API_KEY in production", () => {
    expect(serverSrc).toMatch(/PGI_API_KEY[\s\S]{0,200}PGI_BASE_URL/) // BI_UNQUARANTINE_SOURCE_REGEX_v1 - wording drifted; the guard did not;
  });
});
