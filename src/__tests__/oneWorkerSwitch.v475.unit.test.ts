// BI_SERVER_BLOCK_v475_ONE_WORKER_SWITCH
// v789 [5]/[37]: the server.ts half is now a behaviour test - bootstrap() is
// run with the job starters mocked and BI_WORKERS_ENABLED flipped. index.ts is
// not part of this block, so its import check stays a source read.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const jobs = vi.hoisted(() => ({
  premiumAccrual: vi.fn(),
  purge: vi.fn(),
  docsReminderCron: vi.fn(),
  carrierHealth: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));
vi.mock("../db/boot/schemaRescue", () => ({ runSchemaRescue: async () => undefined }));
vi.mock("../jobs/premiumAccrualJob", async (orig) => ({ ...(await orig<object>()), startPremiumAccrualJob: jobs.premiumAccrual }));
vi.mock("../jobs/purgeJob", async (orig) => ({ ...(await orig<object>()), startPurgeJob: jobs.purge }));
vi.mock("../jobs/docsReminderCronJob", async (orig) => ({ ...(await orig<object>()), startDocsReminderCronJob: jobs.docsReminderCron }));
vi.mock("../services/carrierHealthService", async (orig) => ({ ...(await orig<object>()), startCarrierHealthJob: jobs.carrierHealth }));

import { bootstrap } from "../server";
import { env } from "../platform/env";

const savedDbUrl = env.DATABASE_URL;
const savedSwitch = process.env.BI_WORKERS_ENABLED;
beforeEach(() => {
  for (const fn of Object.values(jobs)) fn.mockReset();
  env.DATABASE_URL = "postgres://unit-test/bi";
});
afterEach(() => {
  env.DATABASE_URL = savedDbUrl;
  if (savedSwitch === undefined) delete process.env.BI_WORKERS_ENABLED;
  else process.env.BI_WORKERS_ENABLED = savedSwitch;
});

describe("v475 one worker switch", () => {
  it("index.ts uses workers/workersSwitch and the old platform switch is gone", () => {
    const index = readFileSync("src/index.ts", "utf8");
    expect(index).toContain('import { workersEnabled } from "./workers/workersSwitch"');
    expect(existsSync("src/platform/workersEnabled.ts")).toBe(false);
  });

  it("gates the scheduled jobs in server.ts: BI_WORKERS_ENABLED=false starts none", async () => {
    process.env.BI_WORKERS_ENABLED = "false";
    await bootstrap();
    for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
  });

  it("starts every scheduled job when the switch is on (or unset)", async () => {
    delete process.env.BI_WORKERS_ENABLED;
    await bootstrap();
    for (const fn of Object.values(jobs)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
