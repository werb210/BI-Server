import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biDocumentRoutes.ts"), "utf8");

describe("BI_SERVER_BLOCK_v387 — /file-url absolute URL", () => {
  it("builds URL from req.get('host')", () => {
    expect(src).toContain('const host = req.get("host");');
    expect(src).toContain('const baseUrl = host ? `${proto}://${host}` : "";');
    expect(src).toContain('`${baseUrl}/api/v1/bi/documents/${encodeURIComponent(req.params.id)}/download`');
  });

  it("includes v387 marker", () => {
    expect(src).toContain("BI_SERVER_BLOCK_v387_FILE_URL_ABSOLUTE_v1");
  });
});
