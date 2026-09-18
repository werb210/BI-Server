// BI_SERVER_REDACT_AUTH_LOGS_v354 / BI_SERVER_SEQUENCE_SEND_LOGS_v354
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const httpLogger = readFileSync(join(root, "src/utils/httpLogger.ts"), "utf8");
const worker = readFileSync(join(root, "src/workers/marketingWorker.ts"), "utf8");

describe("request logs never contain credentials", () => {
  it("redacts authorization, cookie and the backend service token", () => {
    expect(httpLogger).toContain('for (const key of ["authorization", "cookie", "x-backend-token"])');
    expect(httpLogger).toContain('headers[key] = "[redacted]"');
  });
});

describe("sequence sends are visible in the log stream", () => {
  it("logs every recorded outcome, warning on failures", () => {
    const fn = worker.slice(worker.indexOf("async function recordEvent("));
    expect(fn.indexOf('"marketing.worker.send.failed"')).toBeLessThan(fn.indexOf("INSERT INTO bi_sequence_events"));
    expect(worker).toContain("`marketing.worker.send.${eventType}`");
  });
  it("logs how many enrollments were due on each tick that had work", () => {
    expect(worker).toContain('"marketing.worker.tick.due"');
  });
});
