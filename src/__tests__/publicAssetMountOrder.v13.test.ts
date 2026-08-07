// BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const server = readFileSync("src/server.ts", "utf8");

describe("public marketing asset route", () => {
  it("is mounted before any /api/v1/bi mount carrying requireAuth", () => {
    const publicAt = server.indexOf("biMarketingEmailAssetPublicRouter");
    expect(publicAt).toBeGreaterThan(-1);
    const guardedAt = server
      .split("\n")
      .findIndex((line) => line.includes('app.use("/api/v1/bi') && line.includes("requireAuth"));
    const publicLine = server
      .split("\n")
      .findIndex((line) => line.includes('app.use("/api/v1/bi/marketing"') && line.includes("PublicRouter"));
    expect(publicLine).toBeGreaterThan(-1);
    expect(publicLine).toBeLessThan(guardedAt);
  });

  it("keeps the ordering requirement documented at the mount", () => {
    expect(server).toContain("BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13");
  });

  it("does not put requireAuth on the public asset router itself", () => {
    const line = server
      .split("\n")
      .find((candidate) => candidate.includes("biMarketingEmailAssetPublicRouter") && candidate.includes("app.use"));
    expect(line).toBeDefined();
    expect(line).not.toContain("requireAuth");
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
