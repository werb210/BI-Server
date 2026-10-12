// BI_SERVER_v789 [5]/[37] - the route and server.ts checks below were
// source-text greps; they now request the real app (src/server.ts) with
// ../../db mocked and assert on the SQL it sends. Only the migration check
// still reads its .sql file.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { ALLOWED_ORIGIN, applicantBearer, fromBrowser, realApp } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn(answerBySql([]));
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...(a as [])),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...(a as [])), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import { isPlausibleToken, normalizePlatform } from "../biClientPushRoutes";

const PHONE = "+14165550159";
const DEVICE = "f".repeat(64);
beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([]));
});

const root = path.resolve(__dirname, "../../..");

describe("BI_SERVER_PUSH_TOKENS_v159", () => {
  it("accepts a realistic device token", () => {
    expect(isPlausibleToken("f".repeat(64))).toBe(true);
    expect(isPlausibleToken("dGhpcy1pcy1hLWxvbmctZmNtLXRva2Vu-abcdefghij")).toBe(true);
  });

  it("rejects anything too short to be a token", () => {
    expect(isPlausibleToken("abc")).toBe(false);
    expect(isPlausibleToken("")).toBe(false);
    expect(isPlausibleToken(null)).toBe(false);
  });

  it("rejects a token containing whitespace", () => {
    expect(isPlausibleToken("f".repeat(30) + " " + "f".repeat(30))).toBe(false);
  });

  it("rejects an absurdly long value rather than storing it", () => {
    expect(isPlausibleToken("f".repeat(5000))).toBe(false);
  });

  it("only accepts the two platforms that pick a transport", () => {
    expect(normalizePlatform("ios")).toBe("ios");
    expect(normalizePlatform("Android")).toBe("android");
    expect(normalizePlatform("  IOS  ")).toBe("ios");
  });

  it("rejects capacitor, which is the mistake BF-client made", () => {
    // BF-client sent platform:"capacitor" and every token was counted
    // unsupported. The check here makes that a 400 rather than silent data rot.
    expect(normalizePlatform("capacitor")).toBeNull();
    expect(normalizePlatform("web")).toBeNull();
    expect(normalizePlatform("")).toBeNull();
    expect(normalizePlatform(undefined)).toBeNull();
  });

  it("scopes the token to the OTP-proven applicant, never the request body", async () => {
    const app = await realApp();
    const r = await fromBrowser(app, "post", "/api/v1/client/push/register-token").set("Authorization", applicantBearer(PHONE))
      .send({ token: DEVICE, platform: "ios", phone: "+14165550999", applicantPhone: "+14165550998" });
    expect(r.status).toBe(200);
    expect(callsMatching(queryMock, "INSERT INTO bi_client_push_tokens")[0][1]).toEqual([DEVICE, PHONE, "ios"]);
    await fromBrowser(app, "post", "/api/v1/client/push/unregister-token").set("Authorization", applicantBearer(PHONE))
      .send({ token: DEVICE, phone: "+14165550999" });
    expect(callsMatching(queryMock, "DELETE FROM bi_client_push_tokens")[0][1]).toEqual([DEVICE, PHONE]);
  });

  it("requires applicant auth on both routes", async () => {
    const app = await realApp();
    for (const route of ["register-token", "unregister-token"]) {
      const none = await fromBrowser(app, "post", `/api/v1/client/push/${route}`).send({ token: DEVICE, platform: "ios" });
      expect(none.status).toBe(401);
      expect(none.body.error).toBe("missing_bearer");
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("reassigns a token rather than duplicating it across applicants", async () => {
    const app = await realApp();
    await fromBrowser(app, "post", "/api/v1/client/push/register-token").set("Authorization", applicantBearer(PHONE)).send({ token: DEVICE, platform: "android" });
    const sql = String(callsMatching(queryMock, "INSERT INTO bi_client_push_tokens")[0][0]);
    expect(sql).toMatch(/ON CONFLICT \(token\) DO UPDATE/);
    expect(sql).toMatch(/applicant_phone = EXCLUDED\.applicant_phone/);
  });

  it("ships an idempotent migration, as every migration here must be", () => {
    const sql = fs.readFileSync(
      path.join(root, "src/db/migrations/2026_09_11_bi_client_push_tokens_v1.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bi_client_push_tokens");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sql).toContain("CHECK (platform IN ('ios', 'android'))");
  });

  it("mounts under the /api/v1 prefix BI-Client expects, behind the BI cors guard", async () => {
    const app = await realApp();
    const r = await fromBrowser(app, "post", "/api/v1/client/push/register-token").set("Authorization", applicantBearer(PHONE)).send({ token: DEVICE, platform: "capacitor" });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "platform_required" });
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });
});
