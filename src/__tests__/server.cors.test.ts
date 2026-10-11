// BI_HARD_ISOLATION_v59 - pin: every public BI mount must be wrapped in
// biCors. Without this OTP login fails cross-origin from the BI-Website.
// v789 [5]/[37]: rewritten from a grep of server.ts into requests against the
// real app. A mount without biCors shows up as a preflight or a response with
// no Access-Control-Allow-Origin.
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../db", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";

const WEBSITE = "https://www.boreal.insure";

async function preflight(path: string, origin = WEBSITE) {
  return request(app)
    .options(path)
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");
}

describe("BI_HARD_ISOLATION_v59 CORS on public mounts", () => {
  it("biAuthRoutes (OTP): preflight and the real request both carry the allowed origin", async () => {
    const pre = await preflight("/api/v1/otp/request");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEBSITE);
    expect(pre.headers["access-control-allow-credentials"]).toBe("true");

    // Validation failure, but the browser must still be allowed to read it.
    const res = await request(app).post("/api/v1/otp/request").set("Origin", WEBSITE).send({});
    expect(res.status).toBe(400);
    expect(res.headers["access-control-allow-origin"]).toBe(WEBSITE);
  });

  it("chatRoutes is reachable cross-origin", async () => {
    const pre = await preflight("/api/v1/maya-chat");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEBSITE);
  });

  it("intakeRoutes is reachable cross-origin", async () => {
    const pre = await preflight("/api/v1/pgi-intake");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEBSITE);
  });

  it("mayaAnalyticsRoutes is reachable cross-origin", async () => {
    const pre = await preflight("/api/v1/admin-login");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(WEBSITE);
  });

  it("there is no un-CORSed public mount: every public path answers the BI-Website origin", async () => {
    for (const path of ["/api/v1/otp/request", "/api/v1/otp/verify", "/api/v1/maya-chat", "/api/v1/pgi-intake", "/api/v1/admin-login"]) {
      const pre = await preflight(path, "https://boreal.insure");
      expect(pre.headers["access-control-allow-origin"], path).toBe("https://boreal.insure");
    }
  });

  it("an origin that is not on the allowlist is never reflected (v789 exact-origin list)", async () => {
    const pre = await preflight("/api/v1/otp/request", "https://evil.example");
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    const res = await request(app).post("/api/v1/otp/request").set("Origin", "https://evil.example").send({});
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
