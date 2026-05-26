// BI_SERVER_BLOCK_v372_ESCALATION_PHONE_ENV_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const envSrc = fs.readFileSync(path.resolve(__dirname, "../env.ts"), "utf8");
const jobsSrc = fs.readFileSync(path.resolve(__dirname, "../../routes/biJobs.ts"), "utf8");

describe("v372 — BI_ESCALATION_PHONE in validated env", () => {
  it("env.ts declares BI_ESCALATION_PHONE", () => {
    expect(envSrc).toMatch(/BI_ESCALATION_PHONE/);
  });
  it("validated as optional E.164", () => {
    expect(envSrc).toMatch(/BI_ESCALATION_PHONE:[\s\S]*\.regex\(\/\^\\\+\[1-9\]\\d\{1,14\}\$\//);
    expect(envSrc).toMatch(/BI_ESCALATION_PHONE:[\s\S]*\.optional\(\)/);
  });
  it("biJobs.ts reads from validated env, not raw process.env", () => {
    expect(jobsSrc).toMatch(/escalationPhone = env\.BI_ESCALATION_PHONE/);
    expect(jobsSrc).not.toMatch(/process\.env\.BI_ESCALATION_PHONE/);
  });
});
