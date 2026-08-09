// BI_SERVER_EMAIL_LOGO_v24
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { BI_EMAIL_LOGO_FILENAME } from "../routes/biPublicBrandRoutes";
import { renderEmailTemplate } from "../services/emailTemplateRender";

const serverSrc = readFileSync("src/server.ts", "utf8");
const lines = serverSrc.split("\n");

describe("the BI email header logo", () => {
  it("no longer points at BF-Server", () => {
    const html = renderEmailTemplate({ subject: "s", headline: "h", body: "b" });
    expect(html).not.toContain("server.boreal.financial");
  });

  it("points at bi-server's own public asset route", () => {
    const html = renderEmailTemplate({ subject: "s", headline: "h", body: "b" });
    expect(html).toContain("/api/v1/bi/public/email/logo.png");
  });

  it("keeps the Boreal Risk Management alt text", () => {
    const html = renderEmailTemplate({ subject: "s", headline: "h", body: "b" });
    expect(html).toContain('alt="Boreal Risk Management"');
  });

  it("does not double the slash when the base URL has a trailing one", () => {
    const previous = process.env.BI_PUBLIC_BASE_URL;
    process.env.BI_PUBLIC_BASE_URL = "https://example.invalid/";
    try {
      const html = renderEmailTemplate({ subject: "s", headline: "h", body: "b" });
      expect(html).toContain("https://example.invalid/api/v1/bi/public/email/logo.png");
      expect(html).not.toContain("invalid//api");
    } finally {
      if (previous === undefined) delete process.env.BI_PUBLIC_BASE_URL;
      else process.env.BI_PUBLIC_BASE_URL = previous;
    }
  });
});

describe("the uploaded asset", () => {
  it("exists at the path it was uploaded to", () => {
    expect(existsSync(`src/${BI_EMAIL_LOGO_FILENAME}`)).toBe(true);
  });

  it("is a real PNG", () => {
    const bytes = readFileSync(`src/${BI_EMAIL_LOGO_FILENAME}`);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("is copied into dist by the build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toContain("dist/assets");
    expect(pkg.scripts.build).toContain(BI_EMAIL_LOGO_FILENAME);
  });
});

describe("route mounting", () => {
  const brandLine = lines.findIndex((line) => line.includes("biPublicBrandRoutes") && line.includes("app.use"));

  it("is mounted without requireAuth", () => {
    expect(brandLine).toBeGreaterThan(-1);
    expect(lines[brandLine]).not.toContain("requireAuth");
  });

  it("precedes every requireAuth mount on a matching prefix", () => {
    const guards = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes("app.use(") && line.includes("requireAuth") && line.includes('"/api/v1'))
      .map(({ index }) => index);
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) expect(brandLine).toBeLessThan(guard);
  });
});
