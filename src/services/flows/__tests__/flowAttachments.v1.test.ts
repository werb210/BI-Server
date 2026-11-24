// BI_SERVER_FLOW_ATTACHMENTS_v1
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanAttachmentIds, clearAttachmentCache, loadAttachments } from "../flowAttachments";
import { sendDue } from "../../../workers/flowWorker";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => { clearAttachmentCache(); process.env.BACKEND_SERVICE_TOKEN = "svc"; process.env.BF_SERVER_URL = "https://bf.test"; });

describe("flow email attachments", () => {
  it("keeps collateral ids only, without repeats, at most three", () => {
    expect(cleanAttachmentIds([A, A, "nope", B, "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"])).toHaveLength(3);
    expect(cleanAttachmentIds("x")).toEqual([]);
  });

  it("reads each PDF from BF-Server once and names it from the server", async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("%PDF-1"), { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="BI - US - SBA - 1 Pager"' } }));
    const first = await loadAttachments([A], fetchImpl as any);
    await loadAttachments([A], fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as any[])[0]).toBe(`https://bf.test/api/service/collateral/${A}/file`);
    expect(first[0]).toMatchObject({ filename: "BI - US - SBA - 1 Pager.pdf", type: "application/pdf", disposition: "attachment" });
    expect(Buffer.from(first[0].content, "base64").toString()).toBe("%PDF-1");
  });

  it("sends a due flow email with its attachments", async () => {
    const sent: any[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        if (/FROM bi_flow_members m\s+JOIN bi_flows f/.test(sql)) {
          return { rows: [{ id: "m1", flow_id: "f1", contact_id: "c1", email: "x@bank.test", track: "none", next_key: "e1", failures: 0,
            emails: { e1: { subject: "Hi", body: "<p>Hello {{first_name}}</p>", attachments: [A] } }, from_name: "Boreal Risk Management",
            first_name: "Pat", full_name: "Pat Lee", organization_name: "Bank", contact_email: "x@bank.test" }] };
        }
        return { rows: [] };
      }),
    };
    const deps = {
      send: async (m: any) => { sent.push(m); },
      task: async () => ({ ok: true }),
      attachments: async (ids: unknown) => (ids as string[]).map((id) => ({ content: "JVBERg==", filename: `${id}.pdf`, type: "application/pdf", disposition: "attachment" as const })),
    };
    const tuesdayNoonMT = new Date("2026-11-24T18:00:00Z");
    await sendDue(db as any, deps as any, tuesdayNoonMT);
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toEqual([{ content: "JVBERg==", filename: `${A}.pdf`, type: "application/pdf", disposition: "attachment" }]);
  });
});
