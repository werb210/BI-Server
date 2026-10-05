// BI_SERVER_LOGGED_FALLBACKS_v712 / BI_SERVER_LENDER_SANDBOX_LINK_v712
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loggedFallback } from "../lib/queryFallback.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "tests" && n !== "test-support") walk(p, out); }
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("query fallbacks are logged", () => {
  it("logs the failure and returns the fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(loggedFallback("t", { rows: [] })(new Error("boom"))).toEqual({ rows: [] });
    expect(warn).toHaveBeenCalledWith("[query-fallback] t: boom");
    warn.mockRestore();
  });
  it("no query swallows its error into empty rows or a no-op (ROLLBACK cleanup excepted)", () => {
    const bad: string[] = [];
    for (const f of walk("src")) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\(\{\s*rows/.test(line)) bad.push(f + ":" + (i + 1));
        if (/query\(/.test(line) && /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line) && !/ROLLBACK/.test(line)) bad.push(f + ":" + (i + 1));
      });
    }
    expect(bad).toEqual([]);
  });
  it("the LIVE-key text sends lenders to boreal.insure", () => {
    const s = readFileSync("src/routes/biAdminLenderRoutes.ts", "utf8");
    expect(s).toContain("https://www.boreal.insure/lender/sandbox");
    expect(s).not.toContain("https://boreal.financial/lender/sandbox");
  });
});
