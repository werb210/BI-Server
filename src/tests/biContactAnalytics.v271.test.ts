// BI_SERVER_CONTACT_ANALYTICS_v271
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql } from "../__tests__/helpers/answerBySql";

// v789: the wiring case runs against the real app, so the db mock carries the
// whole pool surface and env/logger are the real modules.
const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

const mod = await import("../routes/biContactAnalyticsRoutes");
const { default: app } = await import("../server");

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
    const query = vi.fn(answerBySql([
      ["FROM bi_contacts", { rows: [{ full_name: "Walter Voss", email: "w@voss.ca", outreach_stage: "engaged" }] }],
      ["FROM bi_applications", { rows: [{ stage: "underwriting", status: "document_review", created_at: "2026-09-01" }] }],
      ["FROM bi_contact_activity", { rows: [{ occurred_at: "2026-09-12T15:00:00Z", event_type: "call", outcome: "connected", body: "Asked about premium" }] }],
    ]));
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

// v789 [5]/[37]: was a grep of server.ts; now requests against the real app.
describe("wiring", () => {
  it("is mounted behind auth at /api/v1/bi", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(answerBySql([]));
    const path = "/api/v1/bi/crm/contacts/11111111-1111-4111-8111-111111111111/stage-events";
    expect((await request(app).get(path)).status).toBe(401);
    const staff = jwt.sign({ sub: "staff-1", role: "Staff" }, process.env.JWT_SECRET as string);
    const r = await request(app).get(path).set("Authorization", `Bearer ${staff}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
    expect(String(queryMock.mock.calls.at(-1)?.[0])).toContain("ap.primary_contact_id = $1");
  });
});
