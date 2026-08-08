// BI_SERVER_ASSET_CORP_CROSS_ORIGIN_v19
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PUBLIC_ASSET_HEADERS } from "../routes/biMarketingEmailAssetRoutes.js";

const assetSrc = readFileSync("src/routes/biMarketingEmailAssetRoutes.ts", "utf8");
const serverSrc = readFileSync("src/server.ts", "utf8");

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

  it("applies the headers on the public GET handler", () => {
    expect(assetSrc).toContain("...PUBLIC_ASSET_HEADERS");
  });

  it("does not let Content-Type be overwritten by the shared header set", () => {
    expect(PUBLIC_ASSET_HEADERS["Content-Type"]).toBeUndefined();
    const spread = assetSrc.indexOf("...PUBLIC_ASSET_HEADERS");
    const contentType = assetSrc.indexOf('"Content-Type": result.rows[0].content_type');
    expect(spread).toBeLessThan(contentType);
  });
});

describe("why the override is needed", () => {
  it("helmet is still applied globally", () => {
    // If helmet is ever removed, this override becomes harmless rather than
    // wrong - but the comment explaining it would go stale, so fail loudly.
    expect(serverSrc).toContain("app.use(helmet())");
  });

  it("documents that a browser tab cannot reproduce the failure", () => {
    expect(assetSrc).toContain("BI_SERVER_ASSET_CORP_CROSS_ORIGIN_v19");
    expect(assetSrc).toContain("NotSameOrigin");
  });
});
