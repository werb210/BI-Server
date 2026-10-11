// BI_SERVER_SEND_TEMPLATE_SINGLE_HANDLER_v2
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// v789 [5]/[37]: the source greps (every routes/*.ts file, and
// biMarketingEmailRoutes.ts) are now checks on the real app's router stack and
// requests against the mounted routers. The db mock carries the whole pool
// surface and the logger is the real one so the full app can be imported.
const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: async () => ({ query: (...args: unknown[]) => queryMock(...args), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

const sendMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock("../../services/biSendgridService", async (orig) => ({
  ...(await orig<object>()),
  mergeFields: (value: string, fields: Record<string, string>) =>
    value.replace(/{{\s*([^}\s]+)\s*}}/g, (_match, key: string) => fields[key] || ""),
  sendBiMarketingEmail: (...args: unknown[]) => sendMock(...args),
  sendgridConfigured: () => true,
}));

import biMarketingEmailCompatRoutes from "../biMarketingEmailCompatRoutes";
import biMarketingEmailRoutes from "../biMarketingEmailRoutes";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

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

  it("only one router registers POST /email/send-template", async () => {
    const { default: app } = await import("../../server");
    // Walk every router the real app mounts and collect POST /email/send-template handlers.
    const owners: unknown[] = [];
    const walk = (stack: any[]) => {
      for (const layer of stack) {
        if (layer.route?.path === "/email/send-template" && layer.route.methods?.post) owners.push(layer.route);
        if (Array.isArray(layer.handle?.stack)) walk(layer.handle.stack);
      }
    };
    walk((app as any)._router.stack);
    expect(owners).toHaveLength(1);
    const compatOnly = (biMarketingEmailCompatRoutes as any).stack.filter((l: any) => l.route?.path === "/email/send-template");
    expect(compatOnly).toHaveLength(1);
    expect(owners[0]).toBe(compatOnly[0].route);
  });

  it("biMarketingEmailRoutes on its own has no send-template handler", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/marketing", biMarketingEmailRoutes);
    await request(app).post("/api/v1/bi/marketing/email/send-template").send(composerPayload).expect(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a test send delivers one email and queues nothing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ full_name: "Todd Williams" }] });

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
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_contacts", { rows: [{ count: 3983 }] }],
      ["INSERT INTO bi_marketing_send_jobs", { rows: [{ id: "job-1", scheduled_at: "2026-08-03T22:00:00Z" }] }],
    ], queryMock.getMockImplementation()));

    const res = await request(makeApp())
      .post("/api/v1/bi/marketing/email/send-template")
      .send(composerPayload)
      .expect(202);

    expect(res.body).toMatchObject({ queued: true, jobId: "job-1", total: 3983 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("keeps the endpoints that were never duplicated", async () => {
    queryMock.mockImplementation(answerBySql([
      [/count\(r\.id\)::int AS recipient_count/, { rows: [{ id: "job-9", status: "queued" }], rowCount: 1 }],
      [/UPDATE bi_marketing_send_jobs SET status='cancelled'/, { rows: [{ id: "job-9", status: "cancelled" }], rowCount: 1 }],
    ]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/marketing", biMarketingEmailRoutes);
    const count = await request(app).post("/api/v1/bi/marketing/email/audience-count").send({});
    expect(count.status).toBe(200);
    expect(count.body).toMatchObject({ eligible: 0, sendgridConfigured: true });
    const jobs = await request(app).get("/api/v1/bi/marketing/email/send-jobs").expect(200);
    expect(jobs.body.jobs).toEqual([{ id: "job-9", status: "queued" }]);
    const cancel = await request(app).post("/api/v1/bi/marketing/email/send-jobs/job-9/cancel").expect(200);
    expect(cancel.body.job).toMatchObject({ status: "cancelled" });
  });
});
