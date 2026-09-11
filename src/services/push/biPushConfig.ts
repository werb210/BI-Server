// BI_SERVER_PUSH_SEND_v160
// Which BI push transports are configured, and when one is not, exactly which
// environment variable names are missing.
//
// BI is its own silo with its own bundle ids (com.boreal.risk.client) and its
// own Firebase project, so it does not and must not share BF-Server's
// credentials. Names only: a value is never read back out.

export type BiTransportStatus = {
  transport: "apns" | "fcm";
  configured: boolean;
  missing: string[];
  note: string;
};

export const BI_APNS_VARS = [
  "BI_APNS_TEAM_ID",
  "BI_APNS_KEY_ID",
  "BI_APNS_PRIVATE_KEY",
  "BI_APNS_BUNDLE_ID",
];

export const BI_FCM_VARS = ["BI_FIREBASE_SERVICE_ACCOUNT_JSON"];

function blank(env: NodeJS.ProcessEnv, name: string): boolean {
  return !String(env[name] ?? "").trim();
}

export function biPushConfigReport(env: NodeJS.ProcessEnv = process.env) {
  const transports: BiTransportStatus[] = [
    {
      transport: "apns",
      missing: BI_APNS_VARS.filter((n) => blank(env, n)),
      configured: BI_APNS_VARS.every((n) => !blank(env, n)),
      note: "iOS push for the BI client app; separate credentials from BF",
    },
    {
      transport: "fcm",
      missing: BI_FCM_VARS.filter((n) => blank(env, n)),
      configured: BI_FCM_VARS.every((n) => !blank(env, n)),
      note: "Android push for the BI client app; its own Firebase project",
    },
  ];
  return { anyConfigured: transports.some((t) => t.configured), transports };
}

export function biPushConfigSummary(env: NodeJS.ProcessEnv = process.env): string {
  return biPushConfigReport(env)
    .transports.map((t) => `${t.transport}=${t.configured ? "ok" : "missing[" + t.missing.join(",") + "]"}`)
    .join(" ");
}
