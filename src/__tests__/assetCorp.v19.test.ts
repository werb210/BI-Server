// BI_SERVER_ASSET_CORP_CROSS_ORIGIN_v19
// v789 [5]/[37]: the server.ts grep (helmet) and the handler greps now run as
// requests against the real app. The comment check on the (unchanged) asset
// route file stays a source read: it pins documentation, not behaviour.
import { describe, expect, it, vi, beforeEach } from "vitest";
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
import { PUBLIC_ASSET_HEADERS } from "../routes/biMarketingEmailAssetRoutes.js";

const assetSrc = readFileSync("src/routes/biMarketingEmailAssetRoutes.ts", "utf8");

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    ["FROM bi_email_assets", { rows: [{ content_type: "image/jpeg", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }], rowCount: 1 }],
  ]));
});

describe("public marketing asset headers", () => {
  it("opts out of helmet's same-origin resource policy", () => {
    expect(PUBLIC_ASSET_HEADERS["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
  });

  it("allows any origin, because mail image proxies are unknown in advance", () => {
    expect(PUBLIC_ASSET_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("keeps the immutable cache header the assets already had", () => {
    expect(PUBLIC_ASSET_HEADERS["Cache-Control"]).toContain("immutable");
  });

  it("applies the headers on the public GET handler", async () => {
    const r = await request(app).get("/api/v1/bi/marketing/email/assets/a1");
    expect(r.status).toBe(200);
    expect(r.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(r.headers["cache-control"]).toContain("immutable");
  });

  it("does not let Content-Type be overwritten by the shared header set", async () => {
    expect(PUBLIC_ASSET_HEADERS["Content-Type"]).toBeUndefined();
    const r = await request(app).get("/api/v1/bi/marketing/email/assets/a1");
    expect(r.headers["content-type"]).toContain("image/jpeg");
  });
});

describe("why the override is needed", () => {
  it("helmet is still applied globally", async () => {
    // If helmet is ever removed, this override becomes harmless rather than
    // wrong - but the comment explaining it would go stale, so fail loudly.
    const r = await request(app).get("/");
    expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("documents that a browser tab cannot reproduce the failure", () => {
    expect(assetSrc).toContain("BI_SERVER_ASSET_CORP_CROSS_ORIGIN_v19");
    expect(assetSrc).toContain("NotSameOrigin");
  });
});
