// BI_SERVER_REP_AGREEMENT_v1 - a new rep is sent the PGI Introducer Agreement and their page is locked until it is
// signed. Real database; BF-Server (which holds SignNow) and email are stand-ins.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ emails: [] as any[], calls: [] as Array<{ path: string; body: any }>, signed: false, down: false }));
vi.mock("../../services/biSendgridService", () => ({ sendBiMarketingEmail: vi.fn(async (m: any) => { h.emails.push(m); }) }));
vi.mock("../../services/crmMirrorService", () => ({ mirrorToContact: vi.fn(async () => ({ contact_id: null, created: true })) }));
vi.mock("../../services/smsService", () => ({ sendOutreachSms: vi.fn(async () => ({})) }));

import { fieldPublicRouter, fieldStaffRouter } from "../../routes/biFieldRepRoutes";
import { agreementStatus, welcomeMessage } from "../../services/repAgreement";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("the rep's Introducer Agreement", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", (req, _res, next) => { (req as any).user = { id: null, role: "admin" }; next(); }, fieldStaffRouter);
  app.use("/api/v1", fieldPublicRouter);
  const made: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    process.env.BACKEND_SERVICE_TOKEN = "itest-service-token-0123456789";
    delete process.env.BI_REP_AGREEMENT;
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (!u.includes("/api/service/pgi-rep-agreement")) return realFetch(url, init);
      if (h.down) return json({ ok: false, error: "signing_not_configured" }, 503);
      expect(init.headers["X-Backend-Token"]).toBe("itest-service-token-0123456789");
      const path = u.split("/api/service")[1]!;
      h.calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
      if (path === "/pgi-rep-agreement") return json({ ok: true, groupId: "grp-9", inviteId: "inv-9", documentId: "doc-9", version: "2026-11-16" }, 201);
      if (path === "/pgi-rep-agreement/link") return json({ ok: true, signed: h.signed, url: h.signed ? null : "https://sign.example/fresh" });
      return json({ ok: true, signed: h.signed });
    }) as any;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    for (const id of made) { await pool.query(`DELETE FROM bi_field_contacts WHERE rep_id = $1::uuid`, [id]); await pool.query(`DELETE FROM bi_field_reps WHERE id = $1::uuid`, [id]); }
    await pool.end();
  });
  beforeEach(() => { h.emails.length = 0; h.calls.length = 0; h.signed = false; h.down = false; });

  it("adding a rep needs an email, issues the agreement and emails the rep their page and PIN", async () => {
    expect((await request(app).post("/api/v1/bi/field-reps").send({ full_name: "No Email" })).body).toMatchObject({ error: "email_required" });
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Alex Introducer", company_name: "Itest Advisors", email: "alex@itest.local" });
    expect(r.status).toBe(201);
    made.push(r.body.rep.id);
    expect(r.body.agreement).toEqual({ status: "sent", emailed: true });
    expect(h.calls[0]).toMatchObject({ path: "/pgi-rep-agreement", body: { repId: r.body.rep.id, fullName: "Alex Introducer", email: "alex@itest.local", company: "Itest Advisors" } });
    expect(h.emails[0].to).toBe("alex@itest.local");
    expect(h.emails[0].text).toContain(`/rep/${r.body.rep.code}`);
    expect(h.emails[0].text).toContain(r.body.pin);
    expect(h.emails[0].text).toContain("20% of the commission");

    const list = (await request(app).get("/api/v1/bi/field-reps")).body.reps.find((x: any) => x.id === r.body.rep.id);
    expect(list.agreement).toBe("sent");

    // The page is locked: the rep can sign in and get a signing link, nothing else.
    const token = (await request(app).post("/api/v1/field/login").send({ code: r.body.rep.code, pin: r.body.pin })).body.token;
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).get("/api/v1/field/me").set(auth)).body).toMatchObject({ error: "agreement_required" });
    expect((await request(app).post("/api/v1/field/contacts").set(auth).send({ full_name: "Pat Example", email: "pat@itest.local" })).status).toBe(403);
    expect((await request(app).get("/api/v1/field/agreement").set(auth)).body).toEqual({ ok: true, signed: false, url: "https://sign.example/fresh" });

    // Signed: the page opens and stays open without asking again.
    h.signed = true;
    expect((await request(app).get("/api/v1/field/me").set(auth)).status).toBe(200);
    h.calls.length = 0;
    expect((await request(app).get("/api/v1/field/me").set(auth)).status).toBe(200);
    expect(h.calls).toEqual([]);
    expect((await request(app).get("/api/v1/bi/field-reps")).body.reps.find((x: any) => x.id === r.body.rep.id).agreement).toBe("signed");
    expect((await request(app).post(`/api/v1/bi/field-reps/${r.body.rep.id}/agreement`).send({})).body).toMatchObject({ error: "already_signed" });
  });

  it("if the agreement cannot be issued the rep is still added, the page stays locked, and staff can send it again", async () => {
    h.down = true;
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Later Rep", email: "later@itest.local" });
    made.push(r.body.rep.id);
    expect(r.body.agreement).toMatchObject({ status: "not_sent", emailed: true, error: "signing_not_configured" });
    const token = (await request(app).post("/api/v1/field/login").send({ code: r.body.rep.code, pin: r.body.pin })).body.token;
    expect((await request(app).get("/api/v1/field/me").set({ Authorization: `Bearer ${token}` })).status).toBe(403);
    expect((await request(app).get("/api/v1/field/agreement").set({ Authorization: `Bearer ${token}` })).status).toBe(409);
    h.down = false;
    expect((await request(app).post(`/api/v1/bi/field-reps/${r.body.rep.id}/agreement`).send({})).body).toEqual({ ok: true, agreement: "sent" });
    expect(h.emails.at(-1).subject).toContain("ready to sign");
  });

});

describe("the rep's Introducer Agreement: parts that need no database", () => {
  it("small parts", () => {
    expect(agreementStatus({ agreement_required: false } as any)).toBe("not_required");
    expect(agreementStatus({ agreement_required: true } as any)).toBe("not_sent");
    expect(welcomeMessage({ full_name: "Alex Introducer", code: "ab12cd" }, "123456").html).toContain("/rep/ab12cd");
  });
});
