// BI_SERVER_BLOCK_v581_INTEGRATION_RATCHET - the full (real-database) suite may not get worse.
// Reads vitest's JSON report and scripts/integration-ceiling.json; fails the job when failing
// files, failing tests or files that fail before running anything exceed the ceiling.
import { readFileSync, appendFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ceiling = JSON.parse(readFileSync(new URL("./integration-ceiling.json", import.meta.url), "utf8"));
const failedFiles = report.testResults.filter((t) => t.status === "failed");
const collection = failedFiles.filter((t) => !t.assertionResults.some((a) => a.status === "failed")).length;
const now = { files: report.numFailedTestSuites, tests: report.numFailedTests, collection };
const lines = [
  "## BI integration suite",
  `- Failing files: **${now.files}** (ceiling ${ceiling.maxFailedFiles})`,
  `- Failing tests: **${now.tests}** of ${report.numTotalTests} (ceiling ${ceiling.maxFailedTests})`,
  `- Files that failed before running anything: **${now.collection}** (ceiling ${ceiling.maxCollectionFailures})`,
  "",
  ...failedFiles.map((t) => `- ${t.name.replace(process.cwd() + "/", "")}`),
];
const worse = now.files > ceiling.maxFailedFiles || now.tests > ceiling.maxFailedTests || now.collection > ceiling.maxCollectionFailures;
const better = now.files < ceiling.maxFailedFiles || now.tests < ceiling.maxFailedTests;
lines.push("", worse ? "Regressed. Fix the new failures before merging."
  : better ? `Improved. Lower scripts/integration-ceiling.json to ${now.files} / ${now.tests} / ${now.collection}.` : "At the ceiling.");
const text = lines.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
process.exit(worse ? 1 : 0);
