// BI_SERVER_MOVE_BRM_UNSUBSCRIBES_v1
import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
import { moveBrmUnsubscribes, retryBfNotice } from "../brmUnsubscribeMove";

function db(done = false) {
  const calls: Array<[string, unknown[]]> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    if (/INSERT INTO bi_one_time_jobs/.test(sql)) return { rows: done ? [] : [{ name: "x" }], rowCount: done ? 0 : 1 };
    if (/FROM bi_suppressions/.test(sql)) return { rows: [{ email: "a@x.com" }, { email: "b@x.com" }], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query } as any, calls };
}

describe("moving BRM unsubscribes off the account-wide list", () => {
  it("moves only addresses on the account-wide list, then tells BF-Server", async () => {
    const { db: d } = db();
    const f = vi.fn(async (url: string, init?: any) => {
      if (url.includes("/global/a%40x.com") && !init?.method) return { ok: true, status: 200, json: async () => ({ recipient_email: "a@x.com" }) };
      if (url.includes("/global/") && !init?.method) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: init?.method === "DELETE" ? 204 : 201, json: async () => ({ ok: true }) };
    });
    const out = await moveBrmUnsubscribes(d, { fetch: f as any, apiKey: "k", bfUrl: "https://bf", serviceToken: "t", group: async () => 9 });
    expect(out.moved).toEqual(["a@x.com"]);
    const calls = f.mock.calls.map((c: any[]) => `${c[1]?.method ?? "GET"} ${c[0]}`);
    expect(calls).toContain("POST https://api.sendgrid.com/v3/asm/groups/9/suppressions");
    expect(calls).toContain("DELETE https://api.sendgrid.com/v3/asm/suppressions/global/a%40x.com");
    expect(calls).not.toContain("DELETE https://api.sendgrid.com/v3/asm/suppressions/global/b%40x.com");
    const bf = f.mock.calls.find((c: any[]) => String(c[0]).startsWith("https://bf/"))!;
    expect(JSON.parse(bf[1].body)).toEqual({ brand: "BI", emails: ["a@x.com"] });
  });
  it("runs once", async () => {
    const { db: d } = db(true);
    const f = vi.fn();
    expect((await moveBrmUnsubscribes(d, { fetch: f as any, apiKey: "k", bfUrl: "https://bf", serviceToken: "t", group: async () => 9 })).skipped).toBe("already_done");
    expect(f).not.toHaveBeenCalled();
  });
  it("keeps the job open when BF-Server is not ready, and finishes it on a later try", async () => {
    const { db: d, calls } = db();
    const f = vi.fn(async (url: string, init?: any) => {
      if (url.startsWith("https://bf/")) return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes("/global/") && !init?.method) return { ok: true, status: 200, json: async () => ({ recipient_email: "x" }) };
      return { ok: true, status: 201, json: async () => ({}) };
    });
    await moveBrmUnsubscribes(d, { fetch: f as any, apiKey: "k", bfUrl: "https://bf", serviceToken: "t", group: async () => 9 });
    expect(calls.some(([s]) => /SET done_at = now\(\)/.test(s))).toBe(false);
    const later = { query: vi.fn(async (sql: string) => (/SELECT result/.test(sql) ? { rows: [{ result: { moved: ["a@x.com"] } }], rowCount: 1 } : { rows: [], rowCount: 1 })) };
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ released: 1 }) }));
    expect(await retryBfNotice(later as any, { fetch: ok as any, apiKey: "k", bfUrl: "https://bf", serviceToken: "t", group: async () => 9 })).toBe(true);
  });
});
