// BI_SERVER_EMAIL_FLOWS_v1 - a flow run against a real database: four people, four different behaviours.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../platform/auth", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { role: "admin", userId: "u1" }; next(); } }));
vi.mock("../../services/biSendgridService", async () => {
  const actual = await vi.importActual<typeof import("../../services/biSendgridService")>("../../services/biSendgridService");
  return { ...actual, sendBiMarketingEmail: vi.fn(async () => ({ status: "accepted", statusCode: 202 })) };
});

import router from "../../routes/biFlowRoutes";
import { runFlowTick, type FlowDeps } from "../../workers/flowWorker";
import { flowJobId } from "../../services/flows/flowEngine";

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("an email flow, start to finish", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { role: "admin", userId: "u1" }; next(); });
  app.use("/api/v1/bi", router);
  const tag = "fl" + Math.floor(Math.random() * 1e9);
  const people = ["quiet", "opener", "clicker", "scanner", "gone"];
  const ids: Record<string, string> = {};
  let flowId = "";
  const sent: Array<{ to: string; subject: string; job: string }> = [];
  const tasks: string[] = [];
  const deps: FlowDeps = {
    send: async (m) => { sent.push({ to: m.to, subject: m.subject, job: m.customArgs.job_id! }); },
    task: async (_assignee, title) => { tasks.push(title); return { ok: true }; },
  };
  const MON = new Date("2031-03-03T16:00:00Z"); // a Monday, 10:00 in Alberta, well in the future
  const at = (days: number, hours = 0) => new Date(MON.getTime() + days * 86_400_000 + hours * 3_600_000);
  const event = (who: string, key: string, type: "open" | "click", when: Date, url: string | null = null) => pool.query(
    `INSERT INTO bi_marketing_send_events (job_id, contact_id, email, event_type, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [flowJobId(flowId, key as any), ids[who], `${who}.${tag}@example.com`, type, JSON.stringify({ url }), when]);
  const member = async (who: string) => (await pool.query(`SELECT status, track, sent_keys, next_key, next_at, stop_reason FROM bi_flow_members WHERE flow_id = $1 AND contact_id = $2`, [flowId, ids[who]])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`UPDATE bi_flows SET status = 'archived', preset = NULL WHERE preset = 'lender_us'`);
    for (const who of people) {
      const r = await pool.query(
        `INSERT INTO bi_contacts (full_name, first_name, email, tags, country, organization_name) VALUES ($1,$2,$3,$4,'United States',$5) RETURNING id`,
        [`${who} ${tag}`, who, `${who}.${tag}@example.com`, ["lender", tag], `Bank ${tag}`]);
      ids[who] = r.rows[0].id;
    }
    await pool.query(`INSERT INTO bi_contacts (full_name, email, tags, country) VALUES ($1,$2,$3,'Canada')`, [`north ${tag}`, `north.${tag}@example.com`, ["lender", tag]]);
  });
  afterAll(async () => {
    if (flowId) await pool.query(`DELETE FROM bi_flows WHERE id = $1`, [flowId]);
    await pool.query(`DELETE FROM bi_marketing_send_events WHERE email LIKE $1`, [`%.${tag}@example.com`]);
    await pool.query(`DELETE FROM bi_suppressions WHERE email LIKE $1`, [`%.${tag}@example.com`]);
    await pool.query(`DELETE FROM bi_contact_activity WHERE contact_id IN (SELECT id FROM bi_contacts WHERE $1 = ANY(tags))`, [tag]);
    await pool.query(`DELETE FROM bi_contacts WHERE $1 = ANY(tags)`, [tag]);
    await pool.end();
  });

  it("is created from a ready-made flow and takes only US lenders by their tags, with no adding step", async () => {
    const made = await request(app).post("/api/v1/bi/flows").send({ preset: "lender_us", owner_user_id: "staff-1", owner_name: "Andrew", daily_new: 1000 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    flowId = made.body.id;
    expect((await request(app).post("/api/v1/bi/flows").send({ preset: "lender_us" })).status).toBe(409);
    // BI_SERVER_PGI_COMPLIANCE_v1 - edited copy can be put back to the ready-made wording.
    await request(app).patch(`/api/v1/bi/flows/${flowId}`).send({ emails: { e1: { subject: "Edited", body: "<p>Edited {{link}}</p>" } } });
    expect((await request(app).post(`/api/v1/bi/flows/${flowId}/reset-copy`)).status).toBe(200);
    const after = (await pool.query(`SELECT emails, status FROM bi_flows WHERE id = $1`, [flowId])).rows[0];
    expect(after.emails.e1.subject).toBe("An option your borrowers may not know about");
    expect(after.status).toBe("draft");
    // BI_SERVER_FLOWS_TAGS_ARE_ENOUGH_v1 - creating the flow already took everyone tagged for it. Keep the test to its
    // own people: everyone else in the database stays out of this flow.
    await pool.query(`UPDATE bi_flow_members m SET status = 'stopped', stop_reason = 'test_excluded'
                       FROM bi_contacts c WHERE m.flow_id = $1 AND c.id = m.contact_id AND NOT ($2 = ANY(c.tags))`, [flowId, tag]);
    await pool.query(`INSERT INTO bi_flow_members (flow_id, contact_id, email, status, stop_reason)
                      SELECT $1, id, lower(email), 'stopped', 'test_excluded' FROM bi_contacts WHERE email IS NOT NULL AND NOT ($2 = ANY(tags))
                      ON CONFLICT DO NOTHING`, [flowId, tag]);
    const mine = await pool.query(`SELECT count(*)::int AS n FROM bi_flow_members m JOIN bi_contacts c ON c.id = m.contact_id WHERE m.flow_id = $1 AND $2 = ANY(c.tags)`, [flowId, tag]);
    expect(mine.rows[0].n).toBe(5); // the Canadian lender is not in the US flow
    expect((await request(app).post(`/api/v1/bi/flows/${flowId}/audience`)).body.added).toBe(0);
    const shown = await request(app).get(`/api/v1/bi/flows/${flowId}`);
    expect(shown.body.emails).toHaveLength(7);
    expect(shown.body.emails[0].subject).toBe("An option your borrowers may not know about"); // BI_SERVER_PGI_COMPLIANCE_v1
    expect((await request(app).post(`/api/v1/bi/flows/${flowId}/start`)).body.status).toBe("active");
  });

  it("day 0: everyone gets the first email, except someone who has unsubscribed since", async () => {
    await pool.query(`INSERT INTO bi_suppressions (identifier, email, channel, reason) VALUES ($1, $1, 'email', 'unsubscribe')`, [`gone.${tag}@example.com`]);
    const r = await runFlowTick(pool, deps, MON);
    expect(r.started).toBe(5);
    expect(r.sent).toBe(4);
    expect(sent.filter((s) => s.job.endsWith(":e1"))).toHaveLength(4);
    expect((await member("gone")).stop_reason).toBe("unsubscribed_or_bounced");
    expect((await member("quiet")).next_key).toBe("n2");
  });

  it("what each person does decides the next email", async () => {
    await event("opener", "e1", "open", at(1));
    await event("clicker", "e1", "open", at(1));
    await event("clicker", "e1", "click", at(1, 1), "https://www.boreal.insure/us-lenders");
    await event("scanner", "e1", "click", new Date(MON.getTime() + 15_000), "https://www.boreal.insure/us-lenders"); // 15 seconds after sending
    sent.length = 0;
    const r = await runFlowTick(pool, deps, at(1, 2));
    expect(r.clicked).toBe(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toContain("clicker");
    expect(sent.map((s) => `${s.to.split(".")[0]}:${s.job.slice(-2)}`)).toEqual(["clicker:c1"]);
    expect((await member("clicker")).status).toBe("done");
    expect((await member("opener")).next_key).toBe("o1");
    expect(new Date((await member("opener")).next_at).toISOString()).toBe(at(3).toISOString()); // Tuesday open + 2 business days
    expect((await member("scanner")).track).toBe("none");

    sent.length = 0;
    await runFlowTick(pool, deps, at(3, 1)); // Thursday
    expect(sent.map((s) => `${s.to.split(".")[0]}:${s.job.slice(-2)}`)).toEqual(["opener:o1"]);

    sent.length = 0;
    await runFlowTick(pool, deps, at(7, 1)); // the next Monday
    expect(sent.map((s) => `${s.to.split(".")[0]}:${s.job.slice(-2)}`).sort()).toEqual(["quiet:n2", "scanner:n2"]);
    expect(tasks).toHaveLength(1); // still one call task; a second tick never repeats it
  });

  it("a reply to the reply-to mailbox stops that person's flow (BI_SERVER_FLOW_REPLY_STOP_v1)", async () => {
    const asked: string[] = [];
    const withReplies: FlowDeps = { ...deps, replies: async (mailbox) => {
      asked.push(mailbox);
      return { connected: true, replies: [{ from: `quiet.${tag}@example.com`, at: at(8).toISOString() }, { from: `stranger.${tag}@example.com`, at: at(8).toISOString() }] };
    } };
    await pool.query(`UPDATE bi_flows SET reply_to = 'Replies@Example.com' WHERE id = $1`, [flowId]);
    const r = await runFlowTick(pool, withReplies, at(8, 1));
    expect([...new Set(asked)]).toEqual(["replies@example.com"]); // the one-time out-of-office restart reads the same mailbox
    expect(r.replied).toBe(1);
    expect(await member("quiet")).toMatchObject({ status: "stopped", stop_reason: "replied", next_key: null });
    expect((await member("scanner")).status).toBe("active");
  });

  it("a paused flow sends nothing, and the list shows the numbers", async () => {
    await request(app).post(`/api/v1/bi/flows/${flowId}/pause`);
    sent.length = 0;
    await runFlowTick(pool, deps, at(30));
    expect(sent).toHaveLength(0);
    const list = await request(app).get("/api/v1/bi/flows");
    const f = list.body.flows.find((x: any) => x.id === flowId);
    expect(f).toMatchObject({ status: "paused", opened: 1, clicked: 1 });
    expect(f.emailed).toBe(4);
  });
});
