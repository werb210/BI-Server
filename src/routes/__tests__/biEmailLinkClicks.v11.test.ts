// BI_SERVER_EMAIL_LINK_CLICKS_v11
// v789 [5]/[37]: the biMarketingRoutes.ts grep is now requests to the real
// router. biSendgridWebhookRoutes.ts and the migration are outside this
// rewrite's changed set and keep their source checks.
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biMarketingRoutes from "../biMarketingRoutes";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../db/migrations/2026_08_05_bi_email_link_clicks.sql"), "utf8");

describe("BI email link click capture", () => {
  it("creates the ledger idempotently with no foreign keys", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS bi_email_link_clicks");
    expect(migration).not.toMatch(/REFERENCES/i);
  });

  // BI_SERVER_v789 [5]/[37] - the webhook checks (clicked URL kept on the ledger
  // detail, one bi_email_link_clicks row per click, always 200 with counts) are
  // behaviour tests now: src/__tests__/carrierWiring.v789.test.ts.

  it("exposes the same route shape as BF so one panel serves both silos", async () => {
    const byUrl = { url: "https://boreal.insure/pg", clicks: 7, contacts: 3, last_clicked: "2026-10-01T10:00:00Z" };
    const byContact = { email: "a@b.co", clicks: 2, last_clicked: "2026-10-01T10:00:00Z" };
    queryMock.mockReset();
    queryMock.mockImplementation(answerBySql([
      [/GROUP BY url/, { rows: [byUrl], rowCount: 1 }],
      [/GROUP BY lower\(email\)/, { rows: [byContact], rowCount: 1 }],
    ]));
    const app = express();
    app.use("/api/v1/bi/marketing", biMarketingRoutes);

    const links = await request(app).get("/api/v1/bi/marketing/link-clicks?days=30&jobId=job-1");
    expect(links.status).toBe(200);
    expect(links.body).toEqual({ items: [byUrl], days: 30, jobId: "job-1" });
    const [linkSql] = callsMatching(queryMock, /GROUP BY url/);
    expect(sqlText(linkSql![0])).toContain("count(*)::int AS clicks");
    expect(linkSql![1]).toEqual([30, "job-1"]);

    const who = await request(app).get("/api/v1/bi/marketing/link-clicks/contacts?url=" + encodeURIComponent(byUrl.url));
    expect(who.status).toBe(200);
    expect(who.body).toEqual({ items: [byContact], url: byUrl.url, days: 90 });
  });
});
