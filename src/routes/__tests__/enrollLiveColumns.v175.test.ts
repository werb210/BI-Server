// BI_ENROLL_LIVE_COLUMNS_v175
// Static source guard. The live shape of bi_sequence_enrollments comes from
// src/db/live-schema.json; these three files have each been written against a
// migration twin that never applied.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const live: Record<string, string[]> = JSON.parse(
  readFileSync("src/db/live-schema.json", "utf-8"),
);
const cols = live["bi_sequence_enrollments"];

describe("bi_sequence_enrollments column usage matches the live table", () => {
  it("live table has started_at and next_step_at, not enrolled_at", () => {
    expect(cols).toContain("started_at");
    expect(cols).toContain("next_step_at");
    expect(cols).not.toContain("enrolled_at");
  });

  it("the enroll diagnostic no longer reads enrolled_at", () => {
    const src = readFileSync("src/routes/biMarketingRoutes.ts", "utf-8");
    expect(src).not.toMatch(/e\.enrolled_at/);
    expect(src).toMatch(/e\.started_at >= NOW\(\)/);
  });

  it("resume and stop write the column the worker schedules on", () => {
    const src = readFileSync("src/routes/biSequencesRoutes.ts", "utf-8");
    const worker = readFileSync("src/workers/marketingWorker.ts", "utf-8");
    expect(worker).toMatch(/e\.next_step_at <= NOW\(\)/);
    expect(src).toMatch(/status='active', next_step_at=/);
    expect(src).toMatch(/status='stopped', next_step_at=NULL/);
  });

  it("the v171 migration does not backfill from a nonexistent column", () => {
    const sql = readFileSync(
      "src/db/migrations/2026_09_14_bi_enrollments_created_at_v171.sql",
      "utf-8",
    );
    expect(sql).toContain("BI_ENROLL_LIVE_COLUMNS_v175");
    expect(sql).not.toMatch(/SET created_at = COALESCE\(created_at, enrolled_at/);
  });
});
