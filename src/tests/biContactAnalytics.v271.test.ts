// BI_SERVER_CONTACT_ANALYTICS_v271
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../platform/env", () => ({ env: {} }));
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mod = await import("../routes/biContactAnalyticsRoutes");

describe("stage history for a BI contact", () => {
  it("reads both kinds of stage event from the contact's applications", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { id: "1", application_id: "a", event_type: "application_stage_changed", summary: "Application advanced", meta: { to: "ready_for_submission", trigger: "all_documents_accepted" }, actor_type: "system", created_at: "2026-09-10T10:00:00Z" },
      { id: "2", application_id: "a", event_type: "stage_change", summary: "Stage changed to underwriting", meta: { stage: "underwriting" }, actor_type: "staff", created_at: "2026-09-09T10:00:00Z" },
    ] });
    const events = await mod.stageEventsForContact("c1", query);
    expect(events[0]).toMatchObject({ to_stage: "ready for submission", trigger: "all documents accepted" });
    expect(events[1]).toMatchObject({ to_stage: "underwriting", trigger: "changed by staff" });
    expect(String(query.mock.calls[0][0])).toContain("ap.primary_contact_id = $1");
  });
});

describe("AI summary for a BI contact", () => {
  it("summarises from the contact, its applications and recent activity", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ full_name: "Walter Voss", email: "w@voss.ca", outreach_stage: "engaged" }] })
      .mockResolvedValueOnce({ rows: [{ stage: "underwriting", status: "document_review", created_at: "2026-09-01" }] })
      .mockResolvedValueOnce({ rows: [{ occurred_at: "2026-09-12T15:00:00Z", event_type: "call", outcome: "connected", body: "Asked about premium" }] });
    const model = vi.fn().mockResolvedValue("Walter is in underwriting.");
    expect(await mod.summaryForContact("c1", model, query)).toEqual({ summary: "Walter is in underwriting." });
    const prompt = model.mock.calls[0][0] as string;
    expect(prompt).toContain("Walter Voss");
    expect(prompt).toContain("underwriting (document_review)");
    expect(prompt).toContain("call [connected]: Asked about premium");
  });
  it("says so when AI is not configured or the contact is unknown", async () => {
    expect(await mod.summaryForContact("c1", null, vi.fn().mockResolvedValue({ rows: [{ full_name: "X" }] }))).toEqual({ error: "ai_not_configured", status: 503 });
    expect(await mod.summaryForContact("c1", vi.fn(), vi.fn().mockResolvedValue({ rows: [] }))).toEqual({ error: "not_found", status: 404 });
  });
});

describe("wiring", () => {
  it("is mounted behind auth at /api/v1/bi", () => {
    const server = readFileSync("src/server.ts", "utf-8");
    expect(server).toContain('app.use("/api/v1/bi", requireAuth, biContactAnalyticsRoutes);');
  });
});
