// BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13
// v789 [5]/[37]: the mount-order cases were greps of server.ts; they now fetch
// the asset through the real app with no Authorization header. If any mount
// carrying requireAuth on "/api/v1" or "/api/v1/bi" ran first, these would be
// 401 instead of the asset.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import { answerBySql } from "./helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    [/FROM bi_email_assets WHERE id=\$1/, (_sql: string, params?: unknown[]) =>
      params?.[0] === "asset-1" ? { rows: [{ content_type: "image/png", content: PNG }], rowCount: 1 } : { rows: [], rowCount: 0 }],
  ]));
});

describe("public marketing asset route", () => {
  it("is mounted before any matching prefix carrying requireAuth", async () => {
    const r = await request(app).get("/api/v1/bi/marketing/email/assets/asset-1");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(r.body).equals(PNG)).toBe(true);
  });

  it("keeps the ordering requirement: an unknown asset is the handler's 404, not an auth 401", async () => {
    const r = await request(app).get("/api/v1/bi/marketing/email/assets/missing");
    expect(r.status).toBe(404);
  });

  it("does not put requireAuth on the public asset router itself", async () => {
    // A mail image proxy sends no Authorization header at all.
    const r = await request(app).get("/api/v1/bi/marketing/email/assets/asset-1").set("User-Agent", "GoogleImageProxy");
    expect(r.status).toBe(200);
  });
});

// BI_SERVER_ASSET_ABOVE_ALL_AUTH_MOUNTS_v14
describe("no auth mount on any matching prefix precedes the asset router", () => {
  it("the same prefix is guarded for everything else", async () => {
    // The staff marketing routes share /api/v1/bi/marketing and need a token.
    expect((await request(app).get("/api/v1/bi/marketing/templates")).status).toBe(401);
  });

  it("the asset is still served without a token", async () => {
    expect((await request(app).get("/api/v1/bi/marketing/email/assets/asset-1")).status).toBe(200);
  });
});

describe("asset base url", () => {
  it("prefers the App Service setting name that actually exists", () => {
    const src = readFileSync("src/routes/biMarketingEmailAssetRoutes.ts", "utf8");
    expect(src).toContain("process.env.BI_PUBLIC_BASE_URL");
    expect(src.indexOf("BI_PUBLIC_BASE_URL")).toBeLessThan(src.indexOf('req.get("host")'));
  });
});

describe("test send", () => {
  it("merges fields so a test matches what the blast will render", () => {
    const src = readFileSync("src/routes/biMarketingEmailCompatRoutes.ts", "utf8");
    expect(src).toContain("mergeFields(renderEmailTemplate(template), values)");
    expect(src).toContain("mergeFields(template.subject, values)");
    expect(src).toContain('|| "there"');
  });
});
