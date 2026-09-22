// BI_SERVER_SEQ_HEARTBEAT_v408
// BI_SERVER_SEQ_PARK_INACTIVE_v408
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/workers/marketingWorker.ts"), "utf8");

describe("v408 sequence worker visibility", () => {
  it("logs one line every tick, not only when work exists", () => {
    expect(src).toContain("BI_SERVER_SEQ_HEARTBEAT_v408");
    expect(src).toContain('"marketing.worker.tick"');
    expect(src).not.toContain('if (due.length > 0) logger.info({ due: due.length }, "marketing.worker.tick.due")');
  });

  it("the tick line reports the backlog behind the claim", () => {
    expect(src).toContain("claimed: due.length");
    expect(src).toContain("dueNow:");
    expect(src).toContain("scheduled:");
    expect(src).toContain("FROM bi_sequence_enrollments");
  });

  it("an enrollment on a non-active sequence is parked, not re-claimed forever", () => {
    expect(src).toContain("BI_SERVER_SEQ_PARK_INACTIVE_v408");
    expect(src).toContain("SET next_step_at = NULL WHERE id = $1");
    expect(src).toContain('"marketing.worker.parked_inactive"');
    expect(src).not.toContain('if (!seq || seq.status !== "active") return;');
  });

  it("the v405 claim lease is unchanged", () => {
    expect(src).toContain("BI_SERVER_SEQ_CLAIM_v405");
    expect(src).toContain("FOR UPDATE SKIP LOCKED");
    expect(src).toContain("NOW() + interval '5 minutes'");
  });
});
