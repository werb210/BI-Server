// BI_SERVER_BLOCK_v375_V362_SOFTEN_v1 - behaviour test of the production boot
// guard (rewritten from a source-text test in v789).
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) },
  runMigrations: async () => undefined,
}));

import { pgiBootCheck } from "../server";

const prod = (extra: Record<string, string | undefined>) => ({ NODE_ENV: "production", ...extra }) as NodeJS.ProcessEnv;

describe("v375 - v362 boot guard softened", () => {
  it("does NOT exit on USE_PGI_STUB=true in production; warns instead", () => {
    const r = pgiBootCheck(prod({ USE_PGI_STUB: "true" }));
    expect(r.fatal).toBeUndefined();
    expect(r.warn).toMatch(/\[v375\] WARN: USE_PGI_STUB=true in production/);
  });
  it("still fails when stub=false AND PGI creds are missing", () => {
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "false" })).fatal).toMatch(/PGI_API_KEY and\/or PGI_BASE_URL is missing/);
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "false", PGI_API_KEY: "k" })).fatal).toBeDefined();
  });
  it("stub=false with creds boots silently", () => {
    expect(pgiBootCheck(prod({ USE_PGI_STUB: "false", PGI_API_KEY: "k", PGI_BASE_URL: "https://x" }))).toEqual({});
  });
  it("unset USE_PGI_STUB is warn-only and says live mode (v789: that is what pgiAdapter does)", () => {
    const r = pgiBootCheck(prod({ USE_PGI_STUB: undefined }));
    expect(r.fatal).toBeUndefined();
    expect(r.warn).toMatch(/USE_PGI_STUB is unset in production\. pgiAdapter runs in LIVE mode/);
  });
  it("does nothing outside production", () => {
    expect(pgiBootCheck({ NODE_ENV: "test", USE_PGI_STUB: "false" } as NodeJS.ProcessEnv)).toEqual({});
  });
});
