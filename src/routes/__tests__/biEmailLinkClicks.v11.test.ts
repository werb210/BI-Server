// BI_SERVER_EMAIL_LINK_CLICKS_v11
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const hook = fs.readFileSync(path.resolve(__dirname, "../biSendgridWebhookRoutes.ts"), "utf8");
const routes = fs.readFileSync(path.resolve(__dirname, "../biMarketingRoutes.ts"), "utf8");
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../db/migrations/2026_08_05_bi_email_link_clicks.sql"), "utf8");

describe("BI email link click capture", () => {
  it("creates the ledger idempotently with no foreign keys", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS bi_email_link_clicks");
    expect(migration).not.toMatch(/REFERENCES/i);
  });

  it("keeps the clicked URL on the event ledger detail", () => {
    expect(hook).toContain("url: typeof ev?.url === \"string\"");
  });

  it("records one ledger row per clicked link", () => {
    expect(hook).toContain("INSERT INTO bi_email_link_clicks (job_id, contact_id, email, url)");
  });

  it("still always answers 200 so SendGrid does not replay the batch", () => {
    expect(hook).toContain("res.json({ ok: true, received: events.length, suppressed, logged, linkClicks });");
  });

  it("exposes the same route shape as BF so one panel serves both silos", () => {
    expect(routes).toContain('router.get("/link-clicks"');
    expect(routes).toContain('router.get("/link-clicks/contacts"');
    expect(routes).toContain("count(*)::int AS clicks");
  });
});
