// BI_SEQ_EMAIL_TEMPLATE_AT_SEND_v373
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEmailContent, templateIdOf } from "../sequenceEmailContent";

const root = process.cwd();
const worker = readFileSync(join(root, "src/workers/marketingWorker.ts"), "utf8");
const routes = readFileSync(join(root, "src/routes/biSequencesRoutes.ts"), "utf8");
const migration = readFileSync(join(root, "src/db/migrations/2026_09_21_v373_sequence_step_template_backfill.sql"), "utf8");
const tpl = async () => ({ subject: "Welcome", body: "<p>Hi</p>" });
const none = async () => null;

describe("email step content", () => {
  it("fills a blank subject and body from the step's template", async () => {
    expect(await resolveEmailContent({ subject: "", body: null, conditions: { template_id: "t1" } }, tpl))
      .toEqual({ subject: "Welcome", body: "<p>Hi</p>" });
  });
  it("keeps what the step already has", async () => {
    expect(await resolveEmailContent({ subject: "Mine", body: "", conditions: { template_id: "t1" } }, tpl))
      .toEqual({ subject: "Mine", body: "<p>Hi</p>" });
  });
  it("returns null when there is nothing to send", async () => {
    expect(await resolveEmailContent({ subject: "", body: "", conditions: {} }, tpl)).toBeNull();
    expect(await resolveEmailContent({ subject: null, body: null, conditions: { template_id: "gone" } }, none)).toBeNull();
  });
  it("reads template_id from conditions", () => {
    expect(templateIdOf({ template_id: "abc" })).toBe("abc");
    expect(templateIdOf(null)).toBeNull();
  });
});

describe("wiring", () => {
  it("the worker sends resolved content and does not retry an empty step", () => {
    expect(worker).toContain("await resolveEmailContent(step, loadEmailTemplate)");
    expect(worker).toContain('reason: "empty_email_step"');
    expect(worker).toContain("sendEmail(enr.contact_email, content.subject, content.body, sender)");
  });
  it("step create and edit copy the template in", () => {
    expect(routes.match(/const content = await contentFrom\(req\.body\);/g)?.length).toBe(2);
  });
  it("existing blank steps are backfilled idempotently", () => {
    expect(migration).toContain("s.conditions ? 'template_id'");
    expect(migration).toContain("NULLIF(btrim(s.subject), '') IS NULL");
  });
});
