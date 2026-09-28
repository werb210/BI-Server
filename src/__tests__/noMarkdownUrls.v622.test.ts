// BI_SERVER_URL_FIX_v622 - a paste turned two default URLs into Markdown links
// ("[https://x](https://x)"), which is not a URL. No source file may contain one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : files(p);
    return /\.(ts|js)$/.test(n) ? [p] : [];
  });
}

describe("v622 no Markdown-mangled URLs", () => {
  it("default URLs are plain", () => {
    expect(readFileSync("src/services/biApplicantMessages.ts", "utf8")).toContain('|| "https://server.boreal.financial")');
    expect(readFileSync("src/routes/biApplicantMessageRoutes.ts", "utf8")).toContain('|| "https://client.boreal.insure")');
  });
  it("no source file contains a [url](url) string", () => {
    const bad = files("src").filter((f) => /"\[https?:\/\/[^\]]+\]\(https?:\/\//.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
