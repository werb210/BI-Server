// BI_SERVER_UNIT_TESTS_IN_CI_v6
// vitest.config.ts loads vitest.globalSetup.ts, which THROWS unless
// DATABASE_URL or TEST_DATABASE_URL points at a test database. No CI workflow
// sets one, and `npm test` is `tsc --noEmit && tsc` - so vitest has never run
// in CI at all. Every test in this repo has been dead weight: written, merged,
// never executed.
//
// This config is the same suite with no globalSetup and no database. It
// excludes the 19 files vitest.config.ts already excludes, plus five that
// genuinely need a live connection (verified by running them: they fail on
// pool.connect, not on assertions). What remains is 70 files that pass with
// nothing but node.
//
// The DB-backed suite still exists as `npm run test:integration` for when a
// test database is available. This one is the gate.
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      JWT_SECRET: "test-shared-secret-min-10",
      JWT_REFRESH_SECRET: "test-refresh-secret-min-10",
    },
    exclude: [
      ...configDefaults.exclude,
      // Mirrors the exclusion list in vitest.config.ts.
      "src/tests/pgiAdapter.test.ts",
      "src/tests/pgiRoutes.test.ts",
      "src/routes/__tests__/biApollo.v253.test.ts",
      "src/routes/__tests__/biCrmContactsEditDeleteSms.v255.test.ts",
      "src/routes/__tests__/biCrmContactsEnhanced.v254.test.ts",
      "src/routes/__tests__/biPublicApplicationRoutes.unit.test.ts",
      "src/routes/__tests__/carrierPathE2E.v261.test.ts",
      "src/routes/__tests__/carrierPathE2E.v262.test.ts",
      "src/routes/__tests__/lenderApiCarrierAlignment.v354.test.ts",
      "src/routes/__tests__/realSubmissionFix.v259.test.ts",
      "src/routes/__tests__/secondAcceptAndTextBundle.v373.test.ts",
      "src/routes/tests/applicationSchemaFix.v258.test.ts",
      "src/routes/tests/carrierPathE2E.v260.test.ts",
      "src/routes/tests/realSubmissionFix.v259.test.ts",
      "src/services/__tests__/notificationSms.v366.test.ts",
      "src/__tests__/legacySunsetAndStubGuard.v362.test.ts",
      "src/__tests__/integration/carrier.contract.integration.test.ts",
      "src/db/migrations/__tests__/v384.catalog.align.test.ts",
      "src/lib/validation/__tests__/pgiFields.test.ts",
      // Need a real database - they call pool.connect() rather than a mock.
      "src/routes/__tests__/biCrmCompanies.v256.test.ts",
      "src/routes/__tests__/biDocumentsFromBf.v249.test.ts",
      "src/routes/__tests__/biOutreachCrm.v251.test.ts",
      "src/routes/__tests__/biOutreachImport.v252.test.ts",
      "src/routes/__tests__/biSequencesRoutes.v110.test.ts",
    ],
  },
});
