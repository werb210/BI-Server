import { describe, it, expect } from "vitest";
import {
  routeDevices,
  buildApnsPayload,
  buildFcmMessage,
  safeUrl,
} from "../biPushPayload";
import { biPushConfigReport, biPushConfigSummary, BI_APNS_VARS } from "../biPushConfig";

describe("BI_SERVER_PUSH_SEND_v160 routing", () => {
  it("splits devices by transport", () => {
    const out = routeDevices([
      { token: "a", platform: "ios" },
      { token: "b", platform: "android" },
      { token: "c", platform: "ios" },
    ]);
    expect(out.apns.map((d) => d.token)).toEqual(["a", "c"]);
    expect(out.fcm.map((d) => d.token)).toEqual(["b"]);
    expect(out.unsupported).toBe(0);
  });

  it("counts a platform it cannot dispatch on rather than guessing", () => {
    // "capacitor" is exactly what BF-client sent, and every push vanished.
    const out = routeDevices([
      { token: "a", platform: "capacitor" },
      { token: "b", platform: "web" },
      { token: "c", platform: "" },
    ]);
    expect(out.apns).toEqual([]);
    expect(out.fcm).toEqual([]);
    expect(out.unsupported).toBe(3);
  });

  it("treats a row with no token as unsupported", () => {
    expect(routeDevices([{ token: "", platform: "ios" }]).unsupported).toBe(1);
    expect(routeDevices([{ platform: "ios" }]).unsupported).toBe(1);
  });

  it("is case and whitespace tolerant on platform", () => {
    const out = routeDevices([{ token: "a", platform: " IOS " }]);
    expect(out.apns.length).toBe(1);
  });

  it("handles an empty device list", () => {
    expect(routeDevices([])).toEqual({ apns: [], fcm: [], unsupported: 0 });
  });
});

describe("BI_SERVER_PUSH_SEND_v160 payloads", () => {
  const input = { title: "Documents needed", body: "Two outstanding", url: "/documents" };

  it("puts the alert in aps for APNs, which renders it", () => {
    const p = buildApnsPayload(input) as any;
    expect(p.aps.alert.title).toBe("Documents needed");
    expect(p.aps.alert.body).toBe("Two outstanding");
    expect(p.url).toBe("/documents");
  });

  it("sends Android data-only so the app can draw action buttons", () => {
    const m = buildFcmMessage("tok", input);
    expect("notification" in m.message).toBe(false);
    expect(m.message.data.title).toBe("Documents needed");
    expect(m.message.data.body).toBe("Two outstanding");
    expect(m.message.android.priority).toBe("high");
  });

  it("carries the deep link BI-Client routes on", () => {
    // BI-Client's pushNotificationActionPerformed reads notification.data.url.
    expect(buildFcmMessage("tok", input).message.data.url).toBe("/documents");
    expect((buildApnsPayload(input) as any).url).toBe("/documents");
  });

  it("omits the url when there is none", () => {
    const m = buildFcmMessage("tok", { title: "T", body: "B" });
    expect("url" in m.message.data).toBe(false);
  });

  it("never lets caller data overwrite the rendered title", () => {
    const m = buildFcmMessage("tok", { ...input, data: { title: "Spoof" } });
    expect(m.message.data.title).toBe("Documents needed");
  });

  it("refuses a deep link that is not app-relative", () => {
    expect(safeUrl("/documents")).toBe("/documents");
    expect(safeUrl("https://evil.example/x")).toBe("");
    expect(safeUrl("//evil.example")).toBe("");
    expect(safeUrl("/a/../../etc")).toBe("");
    expect(safeUrl(null)).toBe("");
  });
});

describe("BI_SERVER_PUSH_SEND_v160 config", () => {
  const FULL = {
    BI_APNS_TEAM_ID: "T", BI_APNS_KEY_ID: "K",
    BI_APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
    BI_APNS_BUNDLE_ID: "com.boreal.risk.client",
    BI_FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
  };

  it("reports both configured when they are", () => {
    expect(biPushConfigReport(FULL).anyConfigured).toBe(true);
    expect(biPushConfigReport(FULL).transports.every((t) => t.configured)).toBe(true);
  });

  it("names the missing variable rather than saying not configured", () => {
    const env: NodeJS.ProcessEnv = { ...FULL };
    delete env.BI_APNS_BUNDLE_ID;
    const apns = biPushConfigReport(env).transports.find((t) => t.transport === "apns");
    expect(apns?.missing).toEqual(["BI_APNS_BUNDLE_ID"]);
  });

  it("uses BI-specific names, never BF's shared credentials", () => {
    for (const name of BI_APNS_VARS) expect(name.startsWith("BI_")).toBe(true);
    expect(BI_APNS_VARS).not.toContain("WATCH_APNS_TEAM_ID");
  });

  it("says nothing is configured when nothing is", () => {
    expect(biPushConfigReport({}).anyConfigured).toBe(false);
  });

  it("never reports a value", () => {
    const summary = biPushConfigSummary({ ...FULL, BI_APNS_PRIVATE_KEY: "SECRET" });
    expect(summary).not.toContain("SECRET");
    expect(summary).not.toContain("com.boreal.risk.client");
  });
});
