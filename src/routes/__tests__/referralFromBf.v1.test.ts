// BI_SERVER_REFERRAL_FROM_BF_v1 - behaviour tests (v789: rewritten from
// source-text assertions).
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../db", () => ({
  pool: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) },
  runMigrations: async () => undefined,
}));

import app from "../../server";
import { notifyBfReferralConversion } from "../../services/notifyBfReferralConversion";

afterEach(() => vi.unstubAllGlobals());

describe("bi-server referral unified into BF", () => {
  it("signs a bi-server service JWT and posts to BF referrals-ext/from-bi", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }));
    const r = await notifyBfReferralConversion({ refCode: " bfcode1 ", externalId: "app-1", premium: 1200 });
    expect(r).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/referrals-ext\/from-bi$/);
    const auth = String((calls[0].init.headers as Record<string, string>).authorization);
    const claims = jwt.verify(auth.replace(/^Bearer /, ""), process.env.JWT_SECRET as string) as Record<string, unknown>;
    expect(claims).toMatchObject({ kind: "service", source: "bi-server", iss: "bi-server", aud: "bf-server" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ref_code: "bfcode1", external_id: "app-1", premium: 1200 });
  });

  it("does not call BF without a referral code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await notifyBfReferralConversion({ refCode: "  ", externalId: "x", premium: null })).toEqual({ ok: false, error: "no_ref_code" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // "persists the raw referral code on the application at create" is a
  // behaviour test in src/routes/__tests__/publicApplicationPins.v789.test.ts
  // ("writes referrer_code when the application has none").
  // "notifies BF at policy bind" is in src/__tests__/carrierWiring.v789.test.ts.

  it("no longer serves the BI referrer self-service routes", async () => {
    for (const path of ["/api/v1/referrer/otp/start", "/api/v1/referrer/intake"]) {
      expect((await request(app).post(path).send({})).status).toBe(404);
    }
    expect((await request(app).get("/api/v1/referrer/me")).status).toBe(404);
  });
});
