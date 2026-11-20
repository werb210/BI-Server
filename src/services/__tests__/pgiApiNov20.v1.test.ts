// BI_SERVER_PGI_API_NOV20 - changes from PGicover's current API docs (docs.pgicover.com/api, read 2026-11-20).
import crypto from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("PGicover API changes", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("accepts the documented webhook signature: v1=<hmac of '{timestamp}.{body}'>, within 300 s", async () => {
    const { verifySignature } = await import("../../routes/pgiWebhookRoutes");
    const body = Buffer.from('{"event":"application.quoted"}');
    const secret = "whsec_test";
    const ts = "1795195700";
    const sig = crypto.createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex");
    const now = Number(ts) * 1000;
    expect(verifySignature(body, `v1=${sig}`, ts, now, secret)).toBe(true);
    expect(verifySignature(body, `v1=${sig}`, ts, now + 301_000, secret)).toBe(false);
    expect(verifySignature(body, `v1=${"0".repeat(64)}`, ts, now, secret)).toBe(false);
    const legacy = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, legacy, undefined, now, secret)).toBe(true);
  });

  it("reads events with or without the data envelope, and the event name from X-PGI-Event", async () => {
    const { normalizePgiEvent } = await import("../../routes/pgiWebhookRoutes");
    expect(normalizePgiEvent({ event: "application.quoted", data: { application_id: "A1", quote_id: "Q1" } })).toMatchObject({ event: "application.quoted", application_id: "A1", quote_id: "Q1" });
    expect(normalizePgiEvent({ application_id: "A2", quote_id: "Q2" }, "application.quoted")).toMatchObject({ event: "application.quoted", application_id: "A2" });
  });

  it("reads the documented error envelope", async () => {
    const { readPgiError } = await import("../pgiAdapter");
    expect(readPgiError({ error: { code: "company_already_in_progress", message: "In progress", details: { contact_url: "https://pgicover.com/contact" } } }))
      .toMatchObject({ code: "company_already_in_progress", message: "In progress", contactUrl: "https://pgicover.com/contact" });
  });

  it("sends an Idempotency-Key and turns 409 company_already_in_progress into a clear error", async () => {
    vi.stubEnv("USE_PGI_STUB", "false");
    vi.stubEnv("PGI_API_KEY", "pk_test_x");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "company_already_in_progress", message: "x", contact_url: "https://pgicover.com/c" } }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const m = await import("../pgiAdapter");
    await expect(m.pgiSubmitV2({ form_data: { q0_country: "CA" } } as any)).rejects.toMatchObject({ name: "PgiCompanyInProgressError", contactUrl: "https://pgicover.com/c" });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/^bi-app-[0-9a-f]{40}$/);
    expect(m.pgiIdempotencyKey("app", "a")).toBe(m.pgiIdempotencyKey("app", "a"));
    expect(m.pgiIdempotencyKey("app", "a")).not.toBe(m.pgiIdempotencyKey("app", "b"));
  });
});
