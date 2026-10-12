// BI_SERVER_v789_PGI_TIMEOUTS - every carrier call is bounded at 15 s, a
// Retry-After wait inside a call is capped at 5 s, and carrier error bodies are
// truncated to 500 chars in logs and in thrown messages. Live mode is selected
// explicitly here (USE_PGI_STUB=false) with a fake fetch; the adapter's
// stub/live selection itself is unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logged = vi.hoisted(() => ({ error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("../../platform/logger", () => ({
  logger: {
    error: (...a: unknown[]) => { logged.error.push(a); },
    warn: (...a: unknown[]) => { logged.warn.push(a); },
    info: () => undefined,
  },
}));

type Adapter = typeof import("../pgiAdapter");
let adapter: Adapter;
const realFetch = global.fetch;
const ENV_KEYS = ["USE_PGI_STUB", "PGI_BASE_URL", "PGI_API_KEY", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};

const scoreBody = {
  country: "CA" as const, naics_code: "236220", formation_date: "2015-01-01", loan_amount: 1, pgi_limit: 1,
  annual_revenue: 1, ebitda: 1, total_debt: 1, monthly_debt_service: 1, collateral_value: 1, enterprise_value: 1,
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.USE_PGI_STUB = "false";
  process.env.PGI_BASE_URL = "https://carrier.test";
  process.env.PGI_API_KEY = "pk_test_v789";
  logged.error.length = 0;
  logged.warn.length = 0;
  vi.resetModules();
  adapter = await import("../pgiAdapter");
});

afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("pgiAdapter timeouts (v789)", () => {
  it("aborts a carrier call that does not answer within 15 seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    global.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // never answers, ignores the signal
    }) as any;
    const settled = adapter.pgiSubmit({} as any).then((v) => ({ v }), (e) => ({ e }));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = (await settled) as { e?: Error };
    expect(out.e).toBeInstanceOf(adapter.PgiTimeoutError);
    expect(signal?.aborted).toBe(true);
    expect(adapter.PGI_TIMEOUT_MS).toBe(15_000);
  });

  it("the submit_v2, score, quote and doc upload calls are bounded too", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as any;
    const calls = [
      adapter.pgiSubmitV2({} as any),
      adapter.pgiScore(scoreBody),
      adapter.pgiQuote("Q1"),
      adapter.pgiUploadDocument({ pgiApplicationId: "P1", docType: "loan_agreement", filename: "a.pdf", buffer: Buffer.from("x"), mimeType: "application/pdf" }),
    ].map((p) => (p as Promise<unknown>).then(() => "resolved", (e) => e));
    await vi.advanceTimersByTimeAsync(15_000);
    const results = await Promise.all(calls);
    for (const r of results) expect(r).toBeInstanceOf(adapter.PgiTimeoutError);
  });

  it("caps a long Retry-After wait at 5 seconds and retries once", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => jsonResponse(429, { error: "slow down" }, { "Retry-After": "120" }))
      .mockImplementationOnce(async () => jsonResponse(200, { application_id: "PGI-9", status: "received" }));
    global.fetch = fetchMock as any;
    const settled = adapter.pgiSubmit({} as any).then((v) => ({ v }), (e) => ({ e }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const out = (await settled) as { v?: { application_id: string } };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.v?.application_id).toBe("PGI-9");
  });

  it("retryAfterWaitMs honours short waits and caps long ones", () => {
    expect(adapter.retryAfterWaitMs("2")).toBe(2_000);
    expect(adapter.retryAfterWaitMs("120")).toBe(5_000);
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(adapter.retryAfterWaitMs(new Date(now + 3_600_000).toUTCString(), now)).toBe(5_000);
    expect(adapter.retryAfterWaitMs(null)).toBe(0);
    expect(adapter.retryAfterWaitMs("not a date")).toBe(0);
  });
});

describe("pgiAdapter error bodies are truncated (v789)", () => {
  it("logs at most 500 chars of a failed carrier body", async () => {
    const huge = "E".repeat(5_000);
    global.fetch = vi.fn(async () => jsonResponse(500, { detail: huge })) as any;
    await expect(adapter.pgiSubmit({} as any)).rejects.toThrow("PGI submit failed: 500");
    const entry = logged.error.find((a) => a[1] === "pgi_submit_failed");
    expect(entry).toBeDefined();
    const body = String((entry![0] as { body: unknown }).body);
    expect(body.length).toBeLessThan(560);
    expect(body).toContain("[truncated");
  });

  it("puts at most 500 chars of the carrier body in a thrown submit_v2 error", async () => {
    const huge = "Z".repeat(4_000);
    global.fetch = vi.fn(async () => new Response(huge, { status: 502 })) as any;
    const err = await adapter.pgiSubmitV2({} as any).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message.length).toBeLessThan(620);
    expect(err!.message).toContain("status=502");
  });

  it("truncates a carrier 400 validation dict in the error message", () => {
    const errors: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) errors[`field_${i}`] = "x".repeat(20);
    const e = new adapter.PgiCarrierValidationError(errors);
    expect(e.message.length).toBeLessThan(600);
    expect(Object.keys(e.errors)).toHaveLength(200);
  });
});

// BI_SERVER_v789 [5]/[37] - replaces the source-text check in
// legacySunsetAndStubGuard.v362 ("STUB default is env-aware"): which mode runs
// is decided by USE_PGI_STUB, defaulting to live only in production.
describe("v362 - PGI STUB default is env-aware", () => {
  async function submitWith(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const fetchMock = vi.fn(async () => jsonResponse(200, { application_id: "LIVE-1", status: "received" }));
    global.fetch = fetchMock as any;
    vi.resetModules();
    const a = await import("../pgiAdapter");
    const out = await a.pgiSubmit({} as any);
    return { out, live: fetchMock.mock.calls.length > 0 };
  }
  it("production with USE_PGI_STUB unset calls the carrier", async () => {
    expect((await submitWith({ NODE_ENV: "production", USE_PGI_STUB: undefined })).live).toBe(true);
  });
  it("non-production with USE_PGI_STUB unset uses the stub", async () => {
    const r = await submitWith({ NODE_ENV: "test", USE_PGI_STUB: undefined });
    expect(r.live).toBe(false);
    expect(r.out.application_id).toMatch(/^STUB_APP_/);
  });
  it("an explicit USE_PGI_STUB=false beats the NODE_ENV default; =true forces the stub", async () => {
    expect((await submitWith({ NODE_ENV: "test", USE_PGI_STUB: "false" })).live).toBe(true);
    expect((await submitWith({ NODE_ENV: "production", USE_PGI_STUB: "true" })).live).toBe(false);
  });
});
