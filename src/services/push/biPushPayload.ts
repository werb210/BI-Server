// BI_SERVER_PUSH_SEND_v160
// Payload construction and device routing for BI-Client push.
//
// v159 gave BI-Client somewhere to register its token; nothing could dispatch
// to those tokens. This is the part of dispatch that is worth testing on its
// own: which device gets which transport, and exactly what body each one needs.
// The HTTP providers that carry it follow the shape BF-Server already proved
// (jsonwebtoken/ES256 for APNs, service-account OAuth for FCM).
//
// Two lessons from the BF side are built in rather than relearned:
//   - Android must be data-only, or FCM renders it in the tray itself and the
//     app can never draw action buttons (BF_SERVER_FCM_DATA_ONLY_v157)
//   - a platform value that is not exactly "ios" or "android" silently routes
//     nowhere (BF-client sent "capacitor" and every push was counted
//     unsupported)

export type BiPlatform = "ios" | "android";

export type BiDevice = { token: string; platform: BiPlatform };

export type BiPushInput = {
  title: string;
  body: string;
  /** Deep link the client routes to when tapped. */
  url?: string | null;
  data?: Record<string, string>;
};

export type Routed = {
  apns: BiDevice[];
  fcm: BiDevice[];
  /** Rows whose platform we cannot dispatch on - reported, never guessed at. */
  unsupported: number;
};

/** Splits registered devices by transport. */
export function routeDevices(rows: Array<{ token?: unknown; platform?: unknown }>): Routed {
  const apns: BiDevice[] = [];
  const fcm: BiDevice[] = [];
  let unsupported = 0;

  for (const row of rows) {
    const token = String(row?.token ?? "").trim();
    const platform = String(row?.platform ?? "").trim().toLowerCase();
    if (!token) {
      unsupported += 1;
      continue;
    }
    if (platform === "ios") apns.push({ token, platform: "ios" });
    else if (platform === "android") fcm.push({ token, platform: "android" });
    else unsupported += 1;
  }
  return { apns, fcm, unsupported };
}

function extraData(input: BiPushInput): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.data ?? {})) {
    if (value === undefined || value === null) continue;
    data[key] = String(value);
  }
  // BI-Client's pushNotificationActionPerformed handler routes on data.url.
  const url = String(input.url ?? "").trim();
  if (url) data.url = url;
  return data;
}

/** APNs renders the alert itself, so title and body sit in `aps`. */
export function buildApnsPayload(input: BiPushInput): Record<string, unknown> {
  return {
    aps: {
      alert: { title: input.title, body: input.body },
      sound: "default",
    },
    ...extraData(input),
  };
}

/**
 * Data-only. No `notification` block, so the app is handed the message and
 * renders it itself - the same correction BF-Server needed.
 */
export function buildFcmMessage(token: string, input: BiPushInput) {
  const data = extraData(input);
  data.title = String(input.title ?? "");
  data.body = String(input.body ?? "");
  return {
    message: {
      token,
      data,
      android: { priority: "high" as const },
    },
  };
}

/** A deep link must be app-relative; a push must never drive an arbitrary URL. */
export function safeUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("//")) return "";
  if (!value.startsWith("/")) return "";
  if (value.includes("..")) return "";
  return value;
}
