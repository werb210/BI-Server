// BI_SERVER_BLOCK_v362_LEGACY_SUNSET_AND_STUB_GUARD_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const lenderSrc = fs.readFileSync(path.resolve(__dirname, "../routes/biLenderApiRoutes.ts"), "utf8");
const adapterSrc = fs.readFileSync(path.resolve(__dirname, "../services/pgiAdapter.ts"), "utf8");
const serverSrc = fs.readFileSync(path.resolve(__dirname, "../server.ts"), "utf8");

describe("v362 — legacy shape sunset", () => {
  it("returns 410 Gone for legacy shape", () => {
    expect(lenderSrc).toMatch(/status\(410\)\.json/);
    expect(lenderSrc).toMatch(/error:\s*"legacy_shape_removed"/);
  });
  it("includes migration docs link", () => {
    expect(lenderSrc).toMatch(/boreal\.insure\/lender\/api/);
    expect(lenderSrc).toMatch(/openapi\.json/);
  });
  it("removed the old Deprecation header pretense", () => {
    expect(lenderSrc).not.toMatch(/setHeader\("Deprecation"/);
    expect(lenderSrc).not.toMatch(/setHeader\("Sunset"/);
  });
});

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
    expect(serverSrc).toMatch(/PGI_API_KEY and PGI_BASE_URL required/);
  });
});
