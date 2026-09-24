// BI_SERVER_BLOCK_v472_STAGING_JOBS_OFF
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("v472 scheduled jobs obey BI_WORKERS_ENABLED", () => {
  it("gates the server.ts job loop with workersEnabled()", () => {
    const server = readFileSync(join(__dirname, "..", "server.ts"), "utf8");
    expect(server).toContain('import { workersEnabled } from "./workers/workersSwitch"');
    expect(server).toMatch(/if \(!workersEnabled\(\)\)[^\n]*\n\s*else for \(const \[name, fn\] of \[\s*\["premiumAccrual"/);
  });
});
