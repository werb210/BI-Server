import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isPlausibleToken, normalizePlatform } from "../biClientPushRoutes";

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

  it("scopes the token to the OTP-proven applicant, never the request body", () => {
    const src = fs.readFileSync(path.join(root, "src/routes/biClientPushRoutes.ts"), "utf8");
    expect(src).toContain("req.applicantPhone");
    expect(src).not.toMatch(/req\.body\??\.(phone|applicantPhone)/);
  });

  it("requires applicant auth on both routes", () => {
    const src = fs.readFileSync(path.join(root, "src/routes/biClientPushRoutes.ts"), "utf8");
    expect(src.match(/authApplicant/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("reassigns a token rather than duplicating it across applicants", () => {
    const src = fs.readFileSync(path.join(root, "src/routes/biClientPushRoutes.ts"), "utf8");
    expect(src).toContain("ON CONFLICT (token) DO UPDATE");
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

  it("mounts under the /api/v1 prefix BI-Client expects", () => {
    const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf8");
    expect(server).toContain('app.use("/api/v1", biCors, biClientPushRoutes)');
  });
});
