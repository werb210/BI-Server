// BI_SERVER_BLOCK_v471_WORKERS_SWITCH
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { workersEnabled } from "../workers/workersSwitch";

describe("v471 workers switch", () => {
  it("runs workers by default (production unchanged)", () => {
    expect(workersEnabled({})).toBe(true);
    expect(workersEnabled({ BI_WORKERS_ENABLED: "true" })).toBe(true);
  });
  it("does not run workers where BI_WORKERS_ENABLED=false (staging slot)", () => {
    expect(workersEnabled({ BI_WORKERS_ENABLED: "false" })).toBe(false);
    expect(workersEnabled({ BI_WORKERS_ENABLED: " FALSE " })).toBe(false);
  });
  it("every worker start goes through the switch", () => {
    const src = readFileSync("src/index.ts", "utf8");
    const gate = src.indexOf("if (!workersEnabled()) {");
    const start = src.indexOf("try { fn(); } catch (err) {");
    expect(gate).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(gate);
  });
});
