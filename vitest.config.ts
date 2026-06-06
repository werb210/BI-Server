// BI_SERVER_BLOCK_v355_TEST_SUITE_REPAIR — exclude node:test files from vitest.
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "src/tests/pgiAdapter.test.ts",
      "src/tests/pgiRoutes.test.ts",
    ],
  },
});
