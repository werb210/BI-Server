// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { runBiPipelineQuery, __test } from "../../services/biMayaPipelineQuery";

describe("BI_SERVER_BLOCK_v250 — BI pipeline query matcher", () => {
  beforeEach(() => queryMock.mockReset());

  it("matches 'submissions this week'", () => {
    const m = __test.matchQuery("how many submissions this week");
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.query.key).toBe("submissions_this_week");
  });

  it("matches 'approvals this week'", () => {
    const m = __test.matchQuery("how many approvals this week please");
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.query.key).toBe("approvals_this_week");
  });

  it("matches 'applications in document review'", () => {
    const m = __test.matchQuery("apps in document review");
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.query.key).toBe("in_document_review");
  });

  it("matches 'BF referrals'", () => {
    const m = __test.matchQuery("show me applications referred from BF");
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.query.key).toBe("bf_referrals");
  });

  it("matches 'oldest active application'", () => {
    const m = __test.matchQuery("what's the oldest active application");
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.query.key).toBe("oldest_active_application");
  });

  it("returns not_supported for unmatched questions", () => {
    const m = __test.matchQuery("what's the weather in calgary");
    expect(m.matched).toBe(false);
  });

  it("runBiPipelineQuery returns rows + summary when matched", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "bi-app-1",
          application_code: "BI-ABC123",
          business_name: "Acme",
          stage: "documents_pending",
          status: "in_progress",
          source: "public",
          created_at: "2026-05-01",
        },
      ],
    });
    const r = await runBiPipelineQuery("submissions this week");
    expect(r.ok).toBe(true);
    expect(r.not_supported).toBeFalsy();
    expect(r.rows?.length).toBe(1);
    expect(r.summary).toContain("1 PGI application(s)");
  });

  it("runBiPipelineQuery returns canned list on no match", async () => {
    const r = await runBiPipelineQuery("how is morale on the team");
    expect(r.ok).toBe(true);
    expect(r.not_supported).toBe(true);
    expect(r.supported_queries?.length).toBeGreaterThan(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
