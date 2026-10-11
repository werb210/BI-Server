// BI_SERVER_CORS_CAPACITOR_v20 - native BI-Client origins are allowed.
// v789 [5]/[37]: rewritten from source assertions on server.ts into calls to
// the exact-origin allowlist (src/platform/corsOrigins.ts) and preflights
// against the real app.
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";

vi.mock("../db", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";
import { FIXED_ALLOWED_ORIGINS, isAllowedOrigin } from "../platform/corsOrigins";

const saved = { NODE_ENV: process.env.NODE_ENV, CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function allowOriginFor(origin: string) {
  const r = await request(app)
    .options("/api/v1/applicants/otp/start")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST");
  return r.headers["access-control-allow-origin"];
}

describe("native BI-Client origins are allowed", () => {
  it("allows the iOS Capacitor WebView origin", async () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin("capacitor://localhost")).toBe(true);
    expect(await allowOriginFor("capacitor://localhost")).toBe("capacitor://localhost");
  });

  it("allows the Android WebView origin", async () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(await allowOriginFor("https://localhost")).toBe("https://localhost");
  });

  it("puts them in the hardcoded list, which the env var can only add to", () => {
    expect(FIXED_ALLOWED_ORIGINS).toEqual(expect.arrayContaining(["capacitor://localhost", "https://localhost"]));
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "https://preview.example.com";
    expect(isAllowedOrigin("capacitor://localhost")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("https://preview.example.com")).toBe(true);
  });

  it("does not disturb the existing canonical origins", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ALLOWED_ORIGINS;
    for (const origin of ["https://boreal.insure", "https://www.boreal.insure", "https://staff.boreal.financial"]) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
      expect(await allowOriginFor(origin), origin).toBe(origin);
    }
  });

  // v789 deliberate change: client.boreal.insure is no longer hardcoded; it
  // must be added through CORS_ALLOWED_ORIGINS.
  it("client.boreal.insure needs CORS_ALLOWED_ORIGINS", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(isAllowedOrigin("https://client.boreal.insure")).toBe(false);
    expect(await allowOriginFor("https://client.boreal.insure")).toBeUndefined();
    process.env.CORS_ALLOWED_ORIGINS = "https://client.boreal.insure";
    expect(isAllowedOrigin("https://client.boreal.insure")).toBe(true);
    expect(await allowOriginFor("https://client.boreal.insure")).toBe("https://client.boreal.insure");
  });

  // v789 deliberate change: ionic:// and http://localhost are gone in production.
  it("ionic:// is refused, and http://localhost only outside production", () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin("ionic://localhost")).toBe(false);
    expect(isAllowedOrigin("http://localhost")).toBe(false);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(false);
    process.env.NODE_ENV = "development";
    expect(isAllowedOrigin("ionic://localhost")).toBe(false);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });
});
