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
      // BI_SERVER_BLOCK_v789: the PGI carrier contract test (src/__tests__/integration/
      // carrier.contract.integration.test.ts) is no longer quarantined - it runs here against the
      // real test database and the PGI stub (it pins ALLOW_DEV_OTP/USE_PGI_STUB itself).
    ],
  },
});
