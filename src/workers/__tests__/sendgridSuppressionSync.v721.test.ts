// BI_SERVER_SENDGRID_SUPPRESSION_SYNC_v721
import { describe, it, expect, vi, beforeEach } from "vitest";
const q = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params: any[] }> }));
vi.mock("../../db", () => ({ pool: { query: vi.fn(async (sql: string, params: any[]) => { q.calls.push({ sql, params }); return { rowCount: (params?.[0] ?? []).length }; }) } }));
vi.mock("../../platform/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import { syncSendgridSuppressions, fetchSuppressed } from "../sendgridSuppressionSync";

const lists: Record<string, any[]> = {
  "/v3/suppression/unsubscribes": [{ email: "Kelly@IntegrityLaw.co" }, { email: "a@b.ca" }],
  "/v3/suppression/spam_reports": [{ email: "spam@x.com" }],
  "/v3/suppression/bounces": [{ email: "hard@x.com", status: "5.1.1" }, { email: "soft@x.com", status: "4.2.2" }],
};
const fakeFetch = vi.fn(async (url: string) => {
  const path = new URL(url).pathname;
  return { ok: true, json: async () => lists[path] ?? [] } as any;
}) as any;

describe("SendGrid suppressions reach bi_suppressions", () => {
  beforeEach(() => { q.calls.length = 0; process.env.SENDGRID_API_KEY = "test"; });
  it("copies unsubscribes, spam reports and permanent bounces, lower-cased", async () => {
    const r = await syncSendgridSuppressions(fakeFetch);
    expect(r.checked).toBe(4);
    const all = q.calls.flatMap((c) => c.params[0]);
    expect(all).toEqual(expect.arrayContaining(["kelly@integritylaw.co", "a@b.ca", "spam@x.com", "hard@x.com"]));
    expect(all).not.toContain("soft@x.com");
    expect(q.calls[0]!.sql).toContain("WHERE NOT EXISTS");
    expect(q.calls.map((c) => c.params[1])).toEqual(["sendgrid_unsubscribe", "sendgrid_spam_report", "sendgrid_bounce"]);
  });
  it("does nothing without an API key", async () => {
    delete process.env.SENDGRID_API_KEY;
    expect(await syncSendgridSuppressions(fakeFetch)).toEqual({ checked: 0, added: 0 });
  });
  it("pages through long lists", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ email: `u${i}@x.com` }));
    const f = vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("offset=0") ? page : [{ email: "last@x.com" }]) })) as any;
    const got = await fetchSuppressed("k", { path: "/v3/suppression/unsubscribes", reason: "r" }, f);
    expect(got.length).toBe(501);
  });
});
