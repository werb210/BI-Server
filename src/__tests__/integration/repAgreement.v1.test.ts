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
import { agreementMessage, agreementStatus, runSigningSweep, welcomeMessage } from "../../services/repAgreement";

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

  it("adding a rep sends ONLY the agreement to sign; the welcome with page and PIN goes out once it is signed", async () => {
    expect((await request(app).post("/api/v1/bi/field-reps").send({ full_name: "No Email" })).body).toMatchObject({ error: "email_required" });
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Alex Introducer", company_name: "Itest Advisors", email: "alex@itest.local" });
    expect(r.status).toBe(201);
    made.push(r.body.rep.id);
    expect(r.body.agreement).toEqual({ status: "sent", emailed: true });
    expect(r.body.pin).toBeNull();
    expect(h.calls[0]).toMatchObject({ path: "/pgi-rep-agreement", body: { repId: r.body.rep.id, fullName: "Alex Introducer", email: "alex@itest.local", company: "Itest Advisors" } });

    // One email so far: the agreement. No PIN in it, and it is service mail (no unsubscribe footer).
    expect(h.emails).toHaveLength(1);
    const first = h.emails[0];
    expect(first).toMatchObject({ to: "alex@itest.local", subject: "Your Boreal Risk Management Introducer Agreement", transactional: true });
    expect(first.text).toContain("20% of the commission");
    expect(first.text).not.toMatch(/PIN: \d/);
    const signToken = decodeURIComponent(/\/rep\/[a-z0-9]+\?sign=([^\s"]+)/.exec(first.text)![1]!);
    expect(first.html).toContain("Read and sign the agreement");

    const list = (await request(app).get("/api/v1/bi/field-reps")).body.reps.find((x: any) => x.id === r.body.rep.id);
    expect(list.agreement).toBe("sent");

    // The link in the email fetches the signing link, and cannot open the rep's page.
    const sign = { Authorization: `Bearer ${signToken}` };
    expect((await request(app).get("/api/v1/field/agreement-link").set(sign)).body).toEqual({ ok: true, signed: false, url: "https://sign.example/fresh" });
    expect((await request(app).get("/api/v1/field/me").set(sign)).status).toBe(401);
    expect((await request(app).get("/api/v1/field/agreement-link").set({ Authorization: "Bearer nonsense" })).status).toBe(401);
    expect(h.emails).toHaveLength(1);

    // Signed: the welcome goes out, once, with the page and a PIN that works.
    h.signed = true;
    expect((await request(app).get("/api/v1/field/agreement-link").set(sign)).body).toEqual({ ok: true, signed: true, url: null });
    expect((await request(app).get("/api/v1/field/agreement-link").set(sign)).body).toEqual({ ok: true, signed: true, url: null });
    expect(await runSigningSweep(pool as any)).toBe(0);
    expect(h.emails).toHaveLength(2);
    const welcome = h.emails[1];
    expect(welcome).toMatchObject({ to: "alex@itest.local", subject: "Welcome - your Boreal Risk Management page and PIN", transactional: true });
    expect(welcome.text).toContain(`/rep/${r.body.rep.code}`);
    expect(welcome.text).not.toContain("?sign=");
    const pin = /Your PIN: (\d{4,8})/.exec(welcome.text)![1]!;
    const token = (await request(app).post("/api/v1/field/login").send({ code: r.body.rep.code, pin })).body.token;
    const auth = { Authorization: `Bearer ${token}` };
    h.calls.length = 0;
    expect((await request(app).get("/api/v1/field/me").set(auth)).status).toBe(200);
    expect(h.calls).toEqual([]);
    expect((await request(app).get("/api/v1/bi/field-reps")).body.reps.find((x: any) => x.id === r.body.rep.id).agreement).toBe("signed");
    expect((await request(app).post(`/api/v1/bi/field-reps/${r.body.rep.id}/agreement`).send({})).body).toMatchObject({ error: "already_signed" });
  });

  it("a rep who signs and closes the tab is welcomed by the sweep", async () => {
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Sam Sweep", email: "sam@itest.local" });
    made.push(r.body.rep.id);
    expect(await runSigningSweep(pool as any)).toBe(0);
    expect(h.emails).toHaveLength(1);
    h.signed = true;
    expect(await runSigningSweep(pool as any)).toBeGreaterThanOrEqual(1);
    const mine = h.emails.filter((e) => e.to === "sam@itest.local");
    expect(mine.map((e) => e.subject)).toEqual(["Your Boreal Risk Management Introducer Agreement", "Welcome - your Boreal Risk Management page and PIN"]);
    await runSigningSweep(pool as any);
    expect(h.emails.filter((e) => e.to === "sam@itest.local")).toHaveLength(2);
  });

  it("if the agreement cannot be issued the rep is still added, nothing is emailed, and staff can send it again", async () => {
    h.down = true;
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Later Rep", email: "later@itest.local" });
    made.push(r.body.rep.id);
    expect(r.body.agreement).toMatchObject({ status: "not_sent", emailed: false, error: "signing_not_configured" });
    expect(h.emails).toHaveLength(0);
    h.down = false;
    expect((await request(app).post(`/api/v1/bi/field-reps/${r.body.rep.id}/agreement`).send({})).body).toEqual({ ok: true, agreement: "sent" });
    expect(h.emails.at(-1).subject).toBe("Your Boreal Risk Management Introducer Agreement");
    expect(h.emails.at(-1).text).toContain("?sign=");
  });

});

describe("the rep's Introducer Agreement: parts that need no database", () => {
  it("small parts", () => {
    expect(agreementStatus({ agreement_required: false } as any)).toBe("not_required");
    expect(agreementStatus({ agreement_required: true } as any)).toBe("not_sent");
    expect(welcomeMessage({ full_name: "Alex Introducer", code: "ab12cd" }, "123456").html).toContain("/rep/ab12cd");
    const a = agreementMessage({ id: "11111111-1111-4111-8111-111111111111", full_name: "Alex Introducer", code: "ab12cd" });
    expect(a.text).toContain("/rep/ab12cd?sign=");
    expect(a.text).not.toContain("PIN:");
  });
});
