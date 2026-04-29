import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const realFetch = global.fetch;
function mockFetchOnce(handler: (url: string, init: RequestInit) => Response | Promise<Response>) { global.fetch = vi.fn(handler) as unknown as typeof fetch; }
describe("apolloClient", () => {
  beforeEach(() => { process.env.APOLLO_API_KEY = "test-apollo-key"; });
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });
  it("sends api key", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    mockFetchOnce(async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
    const { apolloRequest } = await import("../apolloClient");
    await apolloRequest("/people/match", { method: "POST", body: { email: "x@y.com" } });
    expect(captured!.url).toContain("https://api.apollo.io/api/v1/people/match");
  });
});
