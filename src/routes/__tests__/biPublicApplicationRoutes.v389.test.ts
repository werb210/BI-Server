import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biPublicApplicationRoutes.ts"), "utf8");

describe("BI_SERVER_BLOCK_v389 — PATCH derives q_business_province", () => {
  it("contains derivation block for q_business_province", () => {
    expect(src).toContain('!("q_business_province" in b)');
    expect(src).toContain('sets.push(`q_business_province = $${i++}`);');
    expect(src).toContain('vals.push(prov);');
  });

  it("includes v389 marker", () => {
    expect(src).toContain("BI_SERVER_BLOCK_v389_PATCH_DERIVE_Q_BUSINESS_PROVINCE_v1");
  });
});
