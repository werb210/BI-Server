// BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const server = readFileSync("src/server.ts", "utf8");

describe("public marketing asset route", () => {
  it("is mounted before any matching prefix carrying requireAuth", () => {
    const publicAt = server.indexOf("biMarketingEmailAssetPublicRouter");
    expect(publicAt).toBeGreaterThan(-1);
    const guardedAt = server
      .split("\n")
      // BI_SERVER_ASSET_ABOVE_ALL_AUTH_MOUNTS_v14 - must consider "/api/v1" too.
      .findIndex((line) => line.includes('app.use("/api/v1') && line.includes("requireAuth"));
    const publicLine = server
      .split("\n")
      .findIndex((line) => line.includes('app.use("/api/v1/bi/marketing"') && line.includes("PublicRouter"));
    expect(publicLine).toBeGreaterThan(-1);
    expect(publicLine).toBeLessThan(guardedAt);
  });

  it("keeps the ordering requirement documented at the mount", () => {
    expect(server).toContain("BI_SERVER_ASSET_ABOVE_ALL_AUTH_MOUNTS_v14");
  });

  it("does not put requireAuth on the public asset router itself", () => {
    const line = server
      .split("\n")
      .find((candidate) => candidate.includes("biMarketingEmailAssetPublicRouter") && candidate.includes("app.use"));
    expect(line).toBeDefined();
    expect(line).not.toContain("requireAuth");
  });
});

// BI_SERVER_ASSET_ABOVE_ALL_AUTH_MOUNTS_v14
describe("no auth mount on any matching prefix precedes the asset router", () => {
  const lines = readFileSync("src/server.ts", "utf8").split("\n");
  const publicLine = lines.findIndex(
    (line) => line.includes("biMarketingEmailAssetPublicRouter") && line.includes("app.use"),
  );

  it("is mounted at all", () => {
    expect(publicLine).toBeGreaterThan(-1);
  });

  it("precedes every requireAuth mount on /api/v1 or /api/v1/bi", () => {
    const guards = lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          line.includes("app.use(") && line.includes("requireAuth") && line.includes('"/api/v1'),
      )
      .map(({ index }) => index);
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) expect(publicLine).toBeLessThan(guard);
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
