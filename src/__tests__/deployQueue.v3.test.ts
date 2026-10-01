// BI_SERVER_DEPLOY_QUEUE_v3
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staging deploy workflow", () => {
  const wf = readFileSync(".github/workflows/main_boreal-staff-server.yml", "utf8");
  it("queues deploys instead of cancelling one part-way through publishing", () => {
    expect(wf).toMatch(/group: bi-server-staging\n  cancel-in-progress: false/);
    expect(wf).not.toMatch(/cancel-in-progress: true/);
  });
});
