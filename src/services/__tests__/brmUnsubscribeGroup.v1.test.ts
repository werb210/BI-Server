// BI_SERVER_BRM_UNSUBSCRIBE_GROUP_v1 - Boreal Risk Management mail unsubscribes from its own group, not the whole account.
import { afterEach, describe, expect, it, vi } from "vitest";
import { brmUnsubscribeGroup, resetBrmGroupCache, withGroupUnsubscribe } from "../biSendgridService";

afterEach(() => { resetBrmGroupCache(); delete process.env.BI_SENDGRID_UNSUBSCRIBE_GROUP_ID; delete process.env.SENDGRID_API_KEY; });

describe("Boreal Risk Management unsubscribe group", () => {
  it("uses the configured group", async () => {
    process.env.BI_SENDGRID_UNSUBSCRIBE_GROUP_ID = "4321";
    expect(await brmUnsubscribeGroup(vi.fn() as any)).toBe(4321);
  });
  it("finds the group by name, or makes it once", async () => {
    process.env.SENDGRID_API_KEY = "k";
    const f = vi.fn(async (_url: string, init?: any) => init?.method === "POST"
      ? { ok: true, status: 201, json: async () => ({ id: 77 }) }
      : { ok: true, status: 200, json: async () => [{ id: 12, name: "Boreal Financial" }] });
    expect(await brmUnsubscribeGroup(f as any, 1000)).toBe(77);
    expect(await brmUnsubscribeGroup(f as any, 2000)).toBe(77);
    expect(f.mock.calls.filter((c: any[]) => c[1]?.method === "POST")).toHaveLength(1);
    resetBrmGroupCache();
    const g = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 55, name: "Boreal Risk Management" }] }));
    expect(await brmUnsubscribeGroup(g as any)).toBe(55);
  });
  it("adds the group's unsubscribe link once", () => {
    const a = withGroupUnsubscribe("<p>Hi</p>", "Hi");
    expect(a.html).toContain("<%asm_group_unsubscribe_raw_url%>");
    expect(a.text).toContain("<%asm_group_unsubscribe_raw_url%>");
    expect(withGroupUnsubscribe(a.html).html).toBe(a.html);
  });
});
