// BI_SERVER_REPLIES_FROM_MAILBOX_v1 - the sending mailbox is read for replies too, and an out-of-office does not stop a flow.
import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../services/biSendgridService", () => ({ biSendgridFrom: () => "Info@Boreal.Financial", mergeFields: (s: string) => s, sendBiMarketingEmail: vi.fn(), sendgridConfigured: () => true }));
import { stopRepliedMembers } from "../flowWorker";

function db(boxes: string[]) {
  const calls: Array<[string, unknown[]]> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    if (/SELECT mailbox, min\(since\)/.test(sql)) return { rows: boxes.map((mailbox) => ({ mailbox, since: "2026-11-20T00:00:00Z" })), rowCount: boxes.length };
    if (/UPDATE bi_flow_members m SET status = 'stopped'/.test(sql)) return { rows: [{ contact_id: "c1", name: "Lenders" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query } as any, calls };
}

describe("flow replies", () => {
  it("reads the sending mailbox", async () => {
    const { db: d, calls } = db(["info@boreal.financial"]);
    const replies = vi.fn(async () => ({ connected: true, replies: [] }));
    await stopRepliedMembers(d, { replies } as any, new Date("2026-11-25T19:00:00Z"));
    expect(calls[0]![1]).toEqual(["info@boreal.financial"]);
    expect(replies).toHaveBeenCalledWith("info@boreal.financial", expect.any(Date));
  });

  it("keeps emailing someone who is only away, and stops a real reply", async () => {
    const { db: d, calls } = db(["info@boreal.financial"]);
    const replies = vi.fn(async () => ({ connected: true, replies: [
      { from: "donna@alterna.ca", at: "2026-11-25T18:45:00Z", auto_reply: true, left: false, referrals: [] },
      { from: "ann@bank.com", at: "2026-11-25T18:46:00Z" },
    ] }));
    const out = await stopRepliedMembers(d, { replies } as any, new Date("2026-11-25T19:00:00Z"));
    const stops = calls.filter(([s]) => /SET status = 'stopped'/.test(s));
    expect(stops.map(([, p]) => p[1])).toEqual(["ann@bank.com"]);
    expect(out.stopped).toBe(1);
  });
});
