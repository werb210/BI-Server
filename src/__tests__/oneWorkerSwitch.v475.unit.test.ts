// BI_SERVER_BLOCK_v475_ONE_WORKER_SWITCH
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("v475 one worker switch", () => {
  const index = readFileSync("src/index.ts", "utf8");
  const server = readFileSync("src/server.ts", "utf8");
  it("index.ts and server.ts both use workers/workersSwitch", () => {
    expect(index).toContain('import { workersEnabled } from "./workers/workersSwitch"');
    expect(server).toContain('import { workersEnabled } from "./workers/workersSwitch"');
    expect(existsSync("src/platform/workersEnabled.ts")).toBe(false);
  });
  it("gates the scheduled jobs in server.ts", () => {
    expect(server).toMatch(/if \(!workersEnabled\(\)\)[^\n]*\n\s*else for \(const \[name, fn\] of \[\s*\["premiumAccrual"/);
  });
});
