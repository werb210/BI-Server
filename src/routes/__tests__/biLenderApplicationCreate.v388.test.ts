import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biLenderApplicationCreate.ts"), "utf8");

describe("BI_SERVER_BLOCK_v388 — lender create writes q_ca_id_*", () => {
  it("updates q_ca_id_type and q_ca_id_number", () => {
    expect(src).toMatch(/q_ca_id_type\s*=\s*COALESCE\(\$5, q_ca_id_type\)/);
    expect(src).toMatch(/q_ca_id_number\s*=\s*COALESCE\(\$6, q_ca_id_number\)/);
  });

  it("includes v388 marker", () => {
    expect(src).toContain("BI_SERVER_BLOCK_v388_LENDER_Q_ID_v1");
  });
});
