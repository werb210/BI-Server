// BI_SERVER_SEND_TEMPLATE_SINGLE_HANDLER_v2
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const sendMock = vi.fn(async () => undefined);
vi.mock("../../services/biSendgridService", () => ({
  sendBiMarketingEmail: (...args: unknown[]) => sendMock(...args),
  sendgridConfigured: () => true,
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import biMarketingEmailCompatRoutes from "../biMarketingEmailCompatRoutes";
import biMarketingEmailRoutes from "../biMarketingEmailRoutes";

// Deliberately the REVERSE of server.ts's registration order. Before this
// change the safe handler only won because it was mounted first; mounting it
// last here proves correctness no longer depends on that.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/marketing", biMarketingEmailRoutes);
  app.use("/api/v1/bi/marketing", biMarketingEmailCompatRoutes);
  return app;
}

const composerPayload = {
  subject: "August PG update",
  headline: "Personal guarantee cover",
  body: "Body copy.",
};

describe("BI_SERVER_SEND_TEMPLATE_SINGLE_HANDLER_v2", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendMock.mockReset();
  });

  it("only one router registers POST /email/send-template", () => {
    const dir = join(process.cwd(), "src/routes");
    const registrations = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        readFileSync(join(dir, name), "utf8").includes('router.post("/email/send-template"'),
      );
    expect(registrations).toEqual(["biMarketingEmailCompatRoutes.ts"]);
  });

  it("a test send delivers one email and queues nothing", async () => {
    const res = await request(makeApp())
      .post("/api/v1/bi/marketing/email/send-template")
      .send({ ...composerPayload, test: "todd.w@boreal.financial" })
      .expect(200);

    expect(res.body).toMatchObject({ test: true, ok: true, to: "todd.w@boreal.financial" });
    expect(sendMock).toHaveBeenCalledTimes(1);

    // The blast this button used to be capable of.
    const statements = queryMock.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => /INSERT INTO bi_marketing_send_jobs/i.test(sql))).toBe(false);
  });

  it("rejects a malformed test address instead of falling through to a blast", async () => {
    await request(makeApp())
      .post("/api/v1/bi/marketing/email/send-template")
      .send({ ...composerPayload, test: "not-an-email" })
      .expect(400);

    expect(sendMock).not.toHaveBeenCalled();
    const statements = queryMock.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => /INSERT INTO bi_marketing_send_jobs/i.test(sql))).toBe(false);
  });

  it("a real send with no test address still queues a job", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 3983 }] })
      .mockResolvedValueOnce({ rows: [{ id: "job-1", scheduled_at: "2026-08-03T22:00:00Z" }] });

    const res = await request(makeApp())
      .post("/api/v1/bi/marketing/email/send-template")
      .send(composerPayload)
      .expect(202);

    expect(res.body).toMatchObject({ queued: true, jobId: "job-1", total: 3983 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("keeps the endpoints that were never duplicated", () => {
    const source = readFileSync(
      join(process.cwd(), "src/routes/biMarketingEmailRoutes.ts"),
      "utf8",
    );
    expect(source).toContain('router.post("/email/audience-count"');
    expect(source).toContain('router.get("/email/send-jobs"');
    expect(source).toContain('router.post("/email/send-jobs/:id/cancel"');
  });
});
