// BI_SERVER_SEQ_CLAIM_v405
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/workers/marketingWorker.ts"), "utf8");

describe("two workers never send the same step", () => {
  it("due enrollments are locked and leased in one statement", () => {
    const pick = src.slice(src.indexOf("async function pickDue"), src.indexOf("async function loadSequence"));
    expect(pick).toContain("FOR UPDATE SKIP LOCKED");
    expect(pick).toContain("SET next_step_at = ${CLAIM_LEASE_SQL}");
    expect(pick).toContain("RETURNING e.id, e.sequence_id, e.contact_id, e.status, e.current_step, e.variant");
  });
  it("the lease is short, so a crashed send is retried", () => {
    expect(src).toContain(`export const CLAIM_LEASE_SQL = "NOW() + interval '5 minutes'";`);
  });
});
