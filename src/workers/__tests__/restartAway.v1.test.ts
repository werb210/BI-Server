// BI_SERVER_RESTART_AWAY_v1
import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../services/biSendgridService", () => ({ biSendgridFrom: () => "info@boreal.financial", mergeFields: (s: string) => s, sendBiMarketingEmail: vi.fn(), sendgridConfigured: () => true }));
import { restartAwayMembers } from "../flowWorker";

describe("people stopped by an out-of-office", () => {
  it("carry on with their next email, once", async () => {
    const calls: Array<[string, unknown[]]> = [];
    let claimed = false;
    const db = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (/INSERT INTO bi_one_time_jobs/.test(sql)) { const first = !claimed; claimed = true; return { rows: first ? [{ name: "x" }] : [], rowCount: first ? 1 : 0 }; }
      if (/SELECT DISTINCT lower/.test(sql)) return { rows: [{ mailbox: "info@boreal.financial" }], rowCount: 1 };
      if (/FROM bi_flow_members WHERE lower\(email\)/.test(sql)) return params[0] === "donna@alterna.ca"
        ? { rows: [{ id: "m1", contact_id: "c1", track: "none", sent_keys: ["e1"], last_sent_at: new Date("2026-11-25T18:00:00Z") }], rowCount: 1 } : { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    }) };
    const replies = vi.fn(async () => ({ connected: true, replies: [
      { from: "donna@alterna.ca", at: "2026-11-25T18:45:00Z", auto_reply: true, left: false },
      { from: "gone@bank.com", at: "2026-11-25T18:46:00Z", auto_reply: true, left: true },
      { from: "ann@bank.com", at: "2026-11-25T18:47:00Z" },
    ] }));
    const now = new Date("2026-11-25T21:00:00Z");
    expect(await restartAwayMembers(db as any, { send: vi.fn(), replies } as any, now)).toBe(1);
    const upd = calls.find(([s]) => /SET status = \$2, stop_reason = NULL/.test(s))!;
    expect(upd[1].slice(0, 3)).toEqual(["m1", "active", "n2"]);
    expect(calls.filter(([s]) => /FROM bi_flow_members WHERE lower\(email\)/.test(s)).map(([, p]) => p[0])).toEqual(["donna@alterna.ca"]);
    expect(await restartAwayMembers(db as any, { send: vi.fn(), replies } as any, now)).toBe(0);
  });
});
