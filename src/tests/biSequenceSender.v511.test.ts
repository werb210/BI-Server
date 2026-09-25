// BI_SERVER_BLOCK_v511_BI_SEQUENCE_SENDER
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const worker = readFileSync(resolve(__dirname, "../workers/marketingWorker.ts"), "utf8");

describe("v511 BI sequence sender", () => {
  afterEach(() => { delete process.env.BI_SEQUENCE_DEFAULT_SENDER; });
  it("never sends with no sender", () => {
    expect(worker).toContain(": biDefaultSender();");
    expect(worker).not.toContain("seq.sender_rotation[enr.current_step % seq.sender_rotation.length] : null;");
  });
  it("defaults to andrew@boreal.financial, overridable by env", () => {
    const m = worker.match(/export function biDefaultSender\(\): string \{[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    const fn = new Function("process", m![0].replace("export function biDefaultSender(): string", "return function ()"))(process);
    expect(fn()).toBe("andrew.p@boreal.financial");
    process.env.BI_SEQUENCE_DEFAULT_SENDER = "insure@boreal.financial";
    expect(fn()).toBe("insure@boreal.financial");
  });
});
