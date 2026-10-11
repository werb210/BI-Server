// BI_SERVER_EMAIL_LOGO_v24
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import request from "supertest";

vi.mock("../db", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";
import { BI_EMAIL_LOGO_FILENAME } from "../routes/biPublicBrandRoutes";
import { renderEmailTemplate } from "../services/emailTemplateRender";

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

// v789 [5]/[37]: was a grep of server.ts; now fetched through the real app
// with no Authorization header, as a mail client or image proxy would.
describe("route mounting", () => {
  it("is mounted without requireAuth", async () => {
    const r = await request(app).get("/api/v1/bi/public/email/logo.png");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(r.body).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("precedes every requireAuth mount on a matching prefix", async () => {
    // Other /api/v1/bi paths are guarded, yet the logo is still served.
    expect((await request(app).get("/api/v1/bi/marketing/templates")).status).toBe(401);
    expect((await request(app).get("/api/v1/bi/public/email/logo.png")).status).toBe(200);
  });
});
