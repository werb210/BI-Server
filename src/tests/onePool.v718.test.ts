// BI_SERVER_ONE_POOL_v718
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("BI-Server uses one database pool", () => {
  it("no route file creates its own pool (they had no keep-alive, no timeouts and no error handler)", () => {
    const routes = readdirSync("src/routes").filter((f) => f.endsWith(".ts"));
    for (const f of routes) expect(readFileSync("src/routes/" + f, "utf8"), f).not.toMatch(/new Pool\(/);
  });
  it("the shared pool keeps idle connections for 5 minutes", () => {
    expect(readFileSync("src/db/index.ts", "utf8")).toContain("idleTimeoutMillis: 300_000,");
  });
});
