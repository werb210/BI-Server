// BI_SERVER_v789_CORS - exact-origin allowlist shared by the CORS middleware,
// apiErrorBoundary and apiTimeoutGuard. No wildcard hosts, and an Origin that
// is not on the list is never reflected back.
//
//   - BF-portal (staff) and the public BI website
//   - Capacitor native apps: iOS sends capacitor://localhost, Android sends
//     https://localhost (nothing but the packaged app can present those)
//   - the BI-Website Azure Static Web Apps hosts used by this project
//   - CORS_ALLOWED_ORIGINS (comma separated) may ADD exact origins
//   - http://localhost[:port] only outside production
export const FIXED_ALLOWED_ORIGINS: readonly string[] = [
  "https://staff.boreal.financial",
  "https://boreal.insure",
  "https://www.boreal.insure",
  "capacitor://localhost",
  "https://localhost",
  // BI-Website Static Web Apps hosts (also listed in examples/lender-api/README.md)
  "https://delightful-sand-05a55580f.7.azurestaticapps.net",
  "https://witty-moss-0886d220f.7.azurestaticapps.net",
];

const LOCAL_DEV_RE = /^http:\/\/localhost(:\d{1,5})?$/;
// An env entry must be a plain scheme://host[:port] - no wildcards or paths.
const EXACT_ORIGIN_RE = /^(https?|capacitor):\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

export function configuredOrigins(raw = process.env.CORS_ALLOWED_ORIGINS || ""): string[] {
  return raw
    .split(",")
    .map((v) => v.trim().replace(/\/+$/, ""))
    .filter((v) => v && EXACT_ORIGIN_RE.test(v));
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (FIXED_ALLOWED_ORIGINS.includes(origin)) return true;
  if (configuredOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCAL_DEV_RE.test(origin)) return true;
  return false;
}

/** Set CORS headers on an error/timeout response only when the Origin is allowed. */
export function setCorsHeadersIfAllowed(origin: string | undefined, res: { setHeader(name: string, value: string): unknown }): void {
  if (!origin || !isAllowedOrigin(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
}
