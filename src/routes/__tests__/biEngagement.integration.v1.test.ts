// BI_SERVER_ENGAGEMENT_v1 against a real Postgres built by the migrations: flows -> stages -> follow-ups -> owners,
// replies from BF-Server, bookings, staff actions, the queue and the funnel.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { pool } from "../../db";
import { requireAuth } from "../../platform/auth";
import biInternalServiceRoutes from "../biInternalServiceRoutes";
import biEngagementRoutes from "../biEngagementRoutes";
import { resetDb, seedCompany, seedContact } from "../../test-support/integrationDb";
import { createFollowUpTasks, syncEngagement } from "../../services/engagement/engagement";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/internal", biInternalServiceRoutes);
  app.use("/api/v1/bi", requireAuth, biEngagementRoutes);
  return app;
}
const admin = () => jwt.sign({ staffUserId: "staff-eng", role: "admin", email: "a@example.com" }, process.env.JWT_SECRET as string);
const service = () => jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string);

async function flowWith(contactId: string, email: string, fields: Record<string, unknown>) {
  const f = await pool.query(
    `INSERT INTO bi_flows (name, audience, status, owner_user_id, owner_name) VALUES ('Lender PGI', 'lender', 'active', 'andrew-1', 'Andrew') RETURNING id`);
  const cols = ["flow_id", "contact_id", "email", ...Object.keys(fields)];
  const vals = [f.rows[0].id, contactId, email, ...Object.values(fields)];
  await pool.query(`INSERT INTO bi_flow_members (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
  return f.rows[0].id as string;
}

describe.skipIf(!process.env.DATABASE_URL)("PGI engagement tracking (real DB)", () => {
  beforeEach(async () => {
    await resetDb();
    await pool.query(`TRUNCATE bi_engagement, bi_engagement_events, bi_engagement_settings, bi_flow_members, bi_flows CASCADE`);
  });
  afterAll(async () => { await pool.end(); });

  it("climbs the stages from the flows, opens a follow-up for a click and gives it the flow's owner", async () => {
    const co = await seedCompany({ legal_name: "Prairie Lending" });
    const c = await seedContact(co.id, { full_name: "Sam Lee", email: "sam@prairie.test" });
    const t0 = new Date(Date.now() - 3 * 86_400_000);
    await flowWith(c.id, "sam@prairie.test", { status: "active", first_sent_at: t0, opened_at: new Date(t0.getTime() + 3_600_000), clicked_at: new Date(t0.getTime() + 7_200_000) });
    await syncEngagement(pool);
    const row = (await pool.query(`SELECT * FROM bi_engagement WHERE contact_id = $1`, [c.id])).rows[0];
    expect(row.stage).toBe("clicked");
    expect(row.follow_up_reason).toBe("clicked");
    expect(row.owner_user_id).toBe("andrew-1");
    expect(row.follow_up_due_at).not.toBeNull();
  });

  it("files a reply BF-Server found, labels it, stops the flow, and makes one task", async () => {
    const co = await seedCompany({ legal_name: "Armada" });
    const c = await seedContact(co.id, { full_name: "Dan Lee", email: "dan@armada.test" });
    await flowWith(c.id, "dan@armada.test", { status: "active", first_sent_at: new Date(Date.now() - 86_400_000) });
    const r = await request(makeApp()).post("/api/v1/bi/internal/engagement/reply").set("Authorization", `Bearer ${service()}`)
      .send({ email: "Dan@Armada.test", at: new Date().toISOString(), subject: "RE: personal guarantee", body: "Does your product apply to our customers?\n\nOn Tue, Andrew wrote:\n> hello" });
    expect(r.status).toBe(200);
    expect(r.body.kinds).toEqual(["question"]);
    const m = (await pool.query(`SELECT status, stop_reason FROM bi_flow_members WHERE contact_id = $1`, [c.id])).rows[0];
    expect(m).toMatchObject({ status: "stopped", stop_reason: "replied" });
    await syncEngagement(pool);
    const e = (await pool.query(`SELECT stage, reply_snippet, follow_up_reason, owner_user_id FROM bi_engagement WHERE contact_id = $1`, [c.id])).rows[0];
    expect(e.stage).toBe("replied");
    expect(e.reply_snippet).toBe("Does your product apply to our customers?");
    const tasks: string[] = [];
    const make = async (_o: string, title: string) => { tasks.push(title); return { ok: true }; };
    expect(await createFollowUpTasks(pool, make)).toBe(1);
    expect(await createFollowUpTasks(pool, make)).toBe(0);
    expect(tasks[0]).toContain("Reply to Dan Lee");
  });

  it("ignores replies and bookings from people the flows never emailed", async () => {
    const co = await seedCompany({});
    await seedContact(co.id, { email: "stranger@x.test" });
    const r = await request(makeApp()).post("/api/v1/bi/internal/engagement/reply").set("Authorization", `Bearer ${service()}`)
      .send({ email: "stranger@x.test", at: new Date().toISOString(), body: "hi" });
    expect(r.body.matched).toBe(0);
    const b = await request(makeApp()).post("/api/v1/bi/internal/engagement/event").set("Authorization", `Bearer ${service()}`)
      .send({ email: "stranger@x.test", kind: "booked" });
    expect(b.body.matched).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM bi_engagement`)).rows[0].n).toBe(0);
  });

  it("an unsubscribe reply closes the door", async () => {
    const co = await seedCompany({});
    const c = await seedContact(co.id, { email: "no@x.test" });
    await flowWith(c.id, "no@x.test", { status: "active", first_sent_at: new Date(Date.now() - 86_400_000) });
    await request(makeApp()).post("/api/v1/bi/internal/engagement/reply").set("Authorization", `Bearer ${service()}`)
      .send({ email: "no@x.test", at: new Date().toISOString(), body: "Please remove me from your list" });
    await syncEngagement(pool);
    const e = (await pool.query(`SELECT stage, follow_up_due_at FROM bi_engagement WHERE contact_id = $1`, [c.id])).rows[0];
    expect(e.stage).toBe("lost");
    expect(e.follow_up_due_at).toBeNull();
  });

  it("bookings, staff actions, round robin, queue and funnel", async () => {
    const co = await seedCompany({});
    const a = await seedContact(co.id, { full_name: "A One", email: "a@x.test" });
    const b = await seedContact(co.id, { full_name: "B Two", email: "b@x.test" });
    const sent = new Date(Date.now() - 2 * 86_400_000);
    await flowWith(a.id, "a@x.test", { status: "active", first_sent_at: sent, clicked_at: new Date(sent.getTime() + 60_000) });
    await flowWith(b.id, "b@x.test", { status: "active", first_sent_at: sent, clicked_at: new Date(sent.getTime() + 60_000) });
    const app = makeApp();
    await request(app).put("/api/v1/bi/engagement/settings").set("Authorization", `Bearer ${admin()}`)
      .send({ followers: [{ id: "u1", name: "Andrew" }, { id: "u2", name: "Todd" }] }).expect(200);
    await syncEngagement(pool);
    const owners = (await pool.query(`SELECT owner_user_id FROM bi_engagement ORDER BY owner_user_id`)).rows.map((r) => r.owner_user_id);
    expect(owners).toEqual(["u1", "u2"]);

    const bk = await request(app).post("/api/v1/bi/internal/engagement/event").set("Authorization", `Bearer ${service()}`)
      .send({ email: "a@x.test", kind: "booked", start: new Date(Date.now() + 86_400_000).toISOString() });
    expect(bk.body.matched).toBe(1);
    const q = await request(app).get("/api/v1/bi/engagement/queue").set("Authorization", `Bearer ${admin()}`).expect(200);
    expect(q.body.items.length).toBe(2);
    await request(app).post(`/api/v1/bi/engagement/contacts/${a.id}/action`).set("Authorization", `Bearer ${admin()}`).send({ action: "met" }).expect(200);
    await request(app).post(`/api/v1/bi/engagement/contacts/${b.id}/action`).set("Authorization", `Bearer ${admin()}`).send({ action: "followed_up" }).expect(200);
    await syncEngagement(pool);
    const q2 = await request(app).get("/api/v1/bi/engagement/queue").set("Authorization", `Bearer ${admin()}`).expect(200);
    expect(q2.body.items.length).toBe(0);
    const board = await request(app).get("/api/v1/bi/engagement/board").set("Authorization", `Bearer ${admin()}`).expect(200);
    expect(board.body.stages.find((s: any) => s.key === "met").count).toBe(1);
    const f = await request(app).get("/api/v1/bi/engagement/funnel").set("Authorization", `Bearer ${admin()}`).expect(200);
    expect(f.body.total).toMatchObject({ sent: 2, clicked: 2, booked: 1, met: 1 });
    const d = await request(app).get(`/api/v1/bi/engagement/contacts/${a.id}`).set("Authorization", `Bearer ${admin()}`).expect(200);
    expect(d.body.contact.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["booked", "met"]));
    const dg = await request(app).get("/api/v1/bi/internal/engagement/digest?owner=u2").set("Authorization", `Bearer ${service()}`).expect(200);
    expect(dg.body.digest.open).toBe(0);
  });
});
