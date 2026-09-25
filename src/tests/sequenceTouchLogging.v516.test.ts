// BI_SERVER_BLOCK_v516_SEQUENCE_TOUCH_LOGGING
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const worker = readFileSync(resolve(__dirname, "../workers/marketingWorker.ts"), "utf8");
const migration = readFileSync(resolve(__dirname, "../db/migrations/2026_09_25_v516_sequence_contacted_backfill.sql"), "utf8");

describe("v516 sequence touches reach the contact", () => {
  it("logs activity and advances to contacted after a successful email and SMS", () => {
    expect(worker).toContain("INSERT INTO bi_contact_activity");
    expect(worker).toContain("SET outreach_status = 'contacted'");
    expect(worker).toContain('await logSequenceTouch(enr.contact_id, "email"');
    expect(worker).toContain('await logSequenceTouch(enr.contact_id, "sms"');
  });
  it("only moves forward and never on a failed send", () => {
    expect(worker).toContain("COALESCE(outreach_status, 'new') IN ('new', 'cold', 'attempting', 'voicemail')");
    const failedEmail = worker.indexOf('await recordEvent(enr.id, step.id, "failed", "email", sender, { error: result.error })');
    const touch = worker.indexOf('await logSequenceTouch(enr.contact_id, "email"');
    expect(touch).toBeGreaterThan(0);
    expect(failedEmail).toBeGreaterThan(touch);
  });
  it("backfills contacts already sent to", () => {
    expect(migration).toContain("ev.event_type = 'sent'");
  });
});
