// BI_SERVER_BLOCK_v472_WORKER_SWITCH_v1
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workersEnabled } from "../workersEnabled";

describe("v472 workersEnabled", () => {
  it("defaults to on when unset or blank", () => {
    expect(workersEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(workersEnabled({ BI_WORKERS_ENABLED: "" } as NodeJS.ProcessEnv)).toBe(true);
    expect(workersEnabled({ BI_WORKERS_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
  it("turns off for false-like values", () => {
    for (const v of ["false", "FALSE", " 0 ", "off", "no", "disabled"]) {
      expect(workersEnabled({ BI_WORKERS_ENABLED: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
  it("gates both worker loops in index.ts and server.ts", () => {
    const root = join(__dirname, "..", "..");
    const index = readFileSync(join(root, "index.ts"), "utf8");
    const server = readFileSync(join(root, "server.ts"), "utf8");
    expect(index).toMatch(/if \(runWorkers\) for \(const \[name, fn\] of \[\s*\["marketingWorker"/);
    expect(server).toMatch(/else for \(const \[name, fn\] of \[\s*\["premiumAccrual"/);
  });
});
