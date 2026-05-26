// BI_SERVER_BLOCK_v375_V362_SOFTEN_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "..", "server.ts"), "utf8");

describe("v375 — v362 boot guard softened", () => {
  it("does NOT exit on USE_PGI_STUB=true in production", () => {
    expect(src).not.toMatch(
      /USE_PGI_STUB=true in production\.[\s\S]{0,80}process\.exit\(1\)/
    );
  });
  it("WARN message in place of FATAL for stubIsOn", () => {
    expect(src).toMatch(/\[v375\] WARN: USE_PGI_STUB=true in production/);
  });
  it("still exits when stub=false AND PGI creds missing", () => {
    expect(src).toMatch(
      /USE_PGI_STUB=false but PGI_API_KEY and\/or PGI_BASE_URL is missing[\s\S]{0,200}process\.exit\(1\)/
    );
  });
  it("treats unset USE_PGI_STUB as warn-only (no exit)", () => {
    expect(src).toMatch(/USE_PGI_STUB is unset in production\. Treating as stub mode/);
  });
});
