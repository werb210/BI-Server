// BI_SERVER_BLOCK_v719
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const worker = read("workers/marketingWorker.ts");
const marketing = read("routes/biMarketingRoutes.ts");
const outreach = read("routes/biOutreachCrmRoutes.ts");
const migration = read("db/migrations/2026_10_09_v719_unstick_enrollments.sql");

describe("BI sequences can actually send", () => {
  it("staff can record a CASL consent basis (nothing ever set it, so every enrollment was skipped)", () => {
    expect(outreach).toContain('router.post("/crm/outreach/contacts/consent"');
    expect(outreach).toContain('["express", "implied_published", "implied_relationship"]');
    expect(outreach).toContain("interval '2 years'");
  });
  it("the worker parks an inactive sequence's enrollment as paused, not active-with-nothing-due", () => {
    expect(worker).toContain("status = 'paused', paused_reason = 'sequence_inactive'");
  });
  it("Start and re-enrolling revive an enrollment stuck active with no next step", () => {
    expect(marketing).toContain("status = 'active' AND next_step_at IS NULL");
    expect(marketing).toContain("bi_sequence_enrollments.status = 'active' AND bi_sequence_enrollments.next_step_at IS NULL");
  });
  it("existing stuck enrollments are repaired once", () => {
    expect(migration).toContain("SET next_step_at = NOW()");
    expect(migration).toContain("WHERE status = 'active' AND next_step_at IS NULL");
  });
  it("the unsubscribe check reads the identifier column the suppression list is written to", () => {
    expect(worker).toContain("lower(identifier) = lower($3)");
  });
});
