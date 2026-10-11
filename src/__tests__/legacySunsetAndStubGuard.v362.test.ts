// BI_SERVER_BLOCK_v362_LEGACY_SUNSET_AND_STUB_GUARD_v1
// BI_SERVER_v789 [5]/[37] - the production boot guard pins below used to read
// server.ts as text; they now run pgiBootCheck(env) and bootstrap() from the
// real src/server.ts with ../db mocked. (v375 softened USE_PGI_STUB=true in
// production from a hard fail to a warning; see v375_v362_soften.test.ts.)
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) },
  runMigrations: async () => undefined,
}));

import { pgiBootCheck, bootstrap } from "../server";

// BI_SERVER_v789 - the legacy-shape sunset (410 legacy_shape_removed with the
// docs + openapi links, no Deprecation/Sunset header) is a behaviour test now:
// src/routes/__tests__/lenderApiCarrierAlignment.v354.test.ts.

// BI_SERVER_v789 [5]/[37] - "STUB default is env-aware" is a behaviour test
// now: src/services/__tests__/pgiAdapter.timeouts.v789.test.ts.

const prod = (extra: Record<string, string | undefined>) => ({ NODE_ENV: "production", ...extra }) as NodeJS.ProcessEnv;

describe("v362 - production boot guard", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["NODE_ENV", "USE_PGI_STUB", "PGI_API_KEY", "PGI_BASE_URL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it("names USE_PGI_STUB=true in production (warn since v375)", () => {
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "true" })).warn).toMatch(/USE_PGI_STUB=true in production/);
  });

  it("is fatal on missing PGI_API_KEY / PGI_BASE_URL in production (live mode)", () => {
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "false" })).fatal).toMatch(/PGI_API_KEY[\s\S]{0,200}PGI_BASE_URL/);
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "false", PGI_BASE_URL: "https://x" })).fatal).toBeDefined();
  });

  it("bootstrap() calls process.exit(1) when the guard is fatal", async () => {
    process.env.NODE_ENV = "production";
    process.env.USE_PGI_STUB = "false";
    delete process.env.PGI_API_KEY;
    delete process.env.PGI_BASE_URL;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    await bootstrap();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
