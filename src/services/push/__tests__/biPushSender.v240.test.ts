// BI_SERVER_PUSH_DISPATCH_v240
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { __resetBiPushDedupe, biDeepLink, buildBiPushProviders, notifyBiApplicant, type BiPushDeps } from "../biPushSender";

function deps(rows: { app?: any; tokens?: any[] } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM bi_applications")) return { rows: rows.app ? [rows.app] : [] };
    if (sql.includes("FROM bi_client_push_tokens")) return { rows: rows.tokens ?? [] };
    return { rows: [] };
  });
  const apns = { send: vi.fn(async () => ({ ok: true, invalid: false })) };
  const fcm = { send: vi.fn(async () => ({ ok: true, invalid: false })) };
  return { query, apns, fcm, d: { query, apns, fcm } as unknown as BiPushDeps };
}

const APP = { public_id: "BI-7K2Q", applicant_phone_e164: "+15875550100", guarantor_phone: null };

describe("BI_SERVER_PUSH_DISPATCH_v240", () => {
  beforeEach(() => __resetBiPushDedupe());

  it("links with the borealrisk:// scheme BI-Client accepts", () => {
    expect(biDeepLink("DOCUMENT_REQUEST", "BI-7K2Q")).toBe("borealrisk://requirements/BI-7K2Q");
    expect(biDeepLink("APPLICATION_UPDATE", "BI-7K2Q")).toBe("borealrisk://home");
    expect(biDeepLink("DOCUMENT_REQUEST", "../x")).toBe("borealrisk://home");
  });

  it("sends iOS with aps.category and the link, Android data-only", async () => {
    const t = deps({ app: APP, tokens: [{ token: "a".repeat(64), platform: "ios" }, { token: "b".repeat(64), platform: "android" }] });
    const result = await notifyBiApplicant({ applicationId: "11111111-2222-4333-8444-555555555555", kind: "DOCUMENT_REQUEST", title: "T", body: "B" }, t.d);
    expect(result.sent).toBe(2);
    const [, apnsPayload] = t.apns.send.mock.calls[0] as any;
    expect(apnsPayload.aps.category).toBe("DOCUMENT_REQUEST");
    expect(apnsPayload.url).toBe("borealrisk://requirements/BI-7K2Q");
    const [fcmMessage] = t.fcm.send.mock.calls[0] as any;
    expect("notification" in fcmMessage.message).toBe(false);
    expect(fcmMessage.message.data.categoryId).toBe("DOCUMENT_REQUEST");
  });

  it("matches applicant and guarantor phones and resolves PGI ids", async () => {
    const t = deps({ app: { ...APP, guarantor_phone: "+14035550100" }, tokens: [] });
    await notifyBiApplicant({ pgiApplicationId: "PGI-123", kind: "APPLICATION_UPDATE", title: "T", body: "B" }, t.d);
    expect(String(t.query.mock.calls[0][0])).toContain("pgi_application_id::text");
    expect(t.query.mock.calls[1][1]).toEqual([["+15875550100", "+14035550100"]]);
  });

  it("removes tokens rejected as invalid", async () => {
    const t = deps({ app: APP, tokens: [{ token: "a".repeat(64), platform: "ios" }] });
    t.apns.send.mockResolvedValueOnce({ ok: false, invalid: true });
    const result = await notifyBiApplicant({ applicationId: "x1", kind: "DOCUMENT_REQUEST", title: "T", body: "B" }, t.d);
    expect(result.removed).toBe(1);
    expect(t.query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM bi_client_push_tokens"))).toBe(true);
  });

  it("does nothing without transports and never throws on query failure", async () => {
    const t = deps({ app: APP });
    expect(await notifyBiApplicant({ applicationId: "x2", kind: "DOCUMENT_REQUEST", title: "T", body: "B" }, { ...t.d, apns: null, fcm: null })).toEqual({ sent: 0, removed: 0 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { query: vi.fn(async () => { throw new Error("boom"); }), apns: t.apns, fcm: null } as unknown as BiPushDeps;
    expect(await notifyBiApplicant({ applicationId: "x3", kind: "DOCUMENT_REQUEST", title: "T", body: "B" }, broken)).toEqual({ sent: 0, removed: 0 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("builds providers only from complete BI credentials", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(buildBiPushProviders({}).apns).toBeNull();
    expect(buildBiPushProviders({ BI_APNS_TEAM_ID: "T", BI_APNS_KEY_ID: "K", BI_APNS_PRIVATE_KEY: pem, BI_APNS_BUNDLE_ID: "com.boreal.risk.client" }).apns).not.toBeNull();
    expect(buildBiPushProviders({ BI_FIREBASE_SERVICE_ACCOUNT_JSON: "{bad" }).fcm).toBeNull();
  });
});
