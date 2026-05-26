// BI_SERVER_BLOCK_v367_DEMO_SESSION_AUTH_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biLenderApiRoutes.ts"), "utf8");

describe("v367 — demo session endpoint requires authLender", () => {
  it("both route registrations include authLender middleware", () => {
    expect(src).toMatch(/router\.post\("\/lender\/demo-session", authLender, demoSessionHandler\)/);
    expect(src).toMatch(/router\.post\("\/lender\/demo\/session", authLender, demoSessionHandler\)/);
  });
  it("handler checks req.lenderId is set", () => {
    expect(src).toMatch(/if \(!req\.lenderId\) return res\.status\(401\)/);
  });
  it("rejects nested-demo (req.lenderIsDemo)", () => {
    expect(src).toMatch(/if \(req\.lenderIsDemo\) return res\.status\(403\)/);
  });
  it("demo JWT includes originating_lender_id for audit", () => {
    expect(src).toMatch(/originating_lender_id:\s*req\.lenderId/);
  });
  it("503 when no demo lender provisioned", () => {
    expect(src).toMatch(/demo_lender_not_provisioned/);
  });
});
