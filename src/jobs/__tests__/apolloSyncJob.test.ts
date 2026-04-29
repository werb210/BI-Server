import { describe, it, expect, vi, beforeEach } from "vitest";

const searchMock = vi.fn();
const listEmailMock = vi.fn();
const upsertMock = vi.fn();
const queryMock = vi.fn();

vi.mock("../../integrations/apollo/apolloClient", () => ({
  ApolloError: class ApolloError extends Error { constructor(public status: number, public body: unknown) { super(`apollo ${status}`); } },
  searchContacts: searchMock,
  listEmailerMessages: listEmailMock,
}));
vi.mock("../../integrations/apollo/apolloContactSync", () => ({
  upsertApolloContact: upsertMock,
}));
vi.mock("../../db", () => ({ pool: { query: queryMock } }));

describe("BI_APOLLO_SYNC_v54_PHASE2 contact sync", () => {
  beforeEach(() => {
    vi.resetModules();
    searchMock.mockReset();
    upsertMock.mockReset();
    queryMock.mockReset();
    process.env.APOLLO_SYNC_ENABLED = "true";
    process.env.APOLLO_API_KEY = "test-key";
  });

  it("is a no-op when APOLLO_SYNC_ENABLED=false", async () => {
    process.env.APOLLO_SYNC_ENABLED = "false";
    const { runContactSyncOnce } = await import("../apolloSyncJob");
    const r = await runContactSyncOnce();
    expect(r).toEqual({ pages: 0, upserted: 0 });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("paginates and upserts each contact, then advances watermark", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ ts: null }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    searchMock
      .mockResolvedValueOnce({
        contacts: [{ id: "p-1", email: "a@x.com" }, { id: "p-2", email: "b@x.com" }],
        pagination: { page: 1, per_page: 100, total_entries: 2, total_pages: 1 },
      });
    upsertMock.mockResolvedValue({ contact_id: "c-1", created: true, apollo_contact_id: "p-1" });

    const { runContactSyncOnce } = await import("../apolloSyncJob");
    const r = await runContactSyncOnce();
    expect(r.upserted).toBe(2);
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ currently_in_sequence: true }));
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });
});

describe("BI_APOLLO_SYNC_v54_PHASE2 engagement sync", () => {
  beforeEach(() => {
    vi.resetModules();
    listEmailMock.mockReset();
    queryMock.mockReset();
    process.env.APOLLO_SYNC_ENABLED = "true";
    process.env.APOLLO_API_KEY = "test-key";
  });

  it("derives one row per observed event_type from a single message", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM bi_apollo_sync_state")) return { rows: [{ ts: null }] };
      if (String(sql).includes("FROM bi_contacts WHERE apollo_contact_id")) return { rows: [{ id: "c-1" }] };
      if (String(sql).includes("INSERT INTO bi_crm_engagement_events")) return { rowCount: 1, rows: [] };
      if (String(sql).includes("UPDATE bi_apollo_sync_state")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });
    listEmailMock.mockResolvedValueOnce({
      messages: [{
        id: "msg-1", contact_id: "p-1",
        delivered_at: "2026-04-20T10:00:00Z",
        opened_at: "2026-04-20T10:30:00Z",
        clicked_at: "2026-04-20T10:31:00Z",
        emailer_campaign: { name: "Cold Outreach Q2" },
      }],
      pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
    });

    const { runEngagementSyncOnce } = await import("../apolloSyncJob");
    const r = await runEngagementSyncOnce();
    expect(r.events_inserted).toBe(3);
  });
});
