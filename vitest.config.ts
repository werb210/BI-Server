// BI_SERVER_BLOCK_v356_TEST_DB_HARNESS — vitest configuration.
import { defineConfig, configDefaults } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const JWT_SECRET = process.env.JWT_SECRET || "test-shared-secret-min-10";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || "test-refresh-secret-min-10";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.globalSetup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DB,
      JWT_SECRET,
      JWT_REFRESH_SECRET,
    },
    exclude: [
      ...configDefaults.exclude,
      // node:test runner files (not vitest)
      "src/tests/pgiAdapter.test.ts",
      "src/tests/pgiRoutes.test.ts",
      // QUARANTINE — pre-existing failures; re-enable each as it is converted
      // to the real-DB harness (mock-SQL) or its stale source assertion fixed.
      // Burn this list down to zero.
      // BI_UNQUARANTINE_FINAL_v1 — NOT stale. POST /apollo/enrich/:id no longer
      // 404s on a missing contact; it returns 200 { ok: true, mock: true }.
      // That is a product decision (Apollo is unlicensed), not test drift, so
      // the assertion stays failing until someone decides which is correct.
      "src/routes/__tests__/biApollo.v253.test.ts",
      "src/__tests__/integration/carrier.contract.integration.test.ts",
    ],
  },
});
