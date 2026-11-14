// BI_SERVER_FIELD_REPS_v1 - outside reps: PIN sign-in, contacts, the information email, the 72-hour text.
// Runs in the integration job against the real database. Email, text and the CRM are stand-ins.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ emails: [] as any[], mirrors: [] as any[] }));
vi.mock("../../services/biSendgridService", () => ({ sendBiMarketingEmail: vi.fn(async (m: any) => { if (String(m.to).startsWith("bounce")) throw new Error("mail down"); sent.emails.push(m); }) }));
vi.mock("../../services/crmMirrorService", () => ({ mirrorToContact: vi.fn(async (m: any) => { sent.mirrors.push(m); return { contact_id: null, created: true }; }) }));
vi.mock("../../services/smsService", () => ({ sendOutreachSms: vi.fn(async () => ({})) }));

import { fieldPublicRouter, fieldStaffRouter, cardFields, contactStatus, creditLeadToRep } from "../../routes/biFieldRepRoutes";
import { cleanContact, followUpEmail, followUpSms, hashPin, pinMatches, readRepToken, runFollowUpSmsTick, signRepToken, smsWindowOpen, validRepCode } from "../../services/fieldReps";

describe("field reps: the parts that need no database", () => {
  it("a PIN only matches its own hash", () => {
    const h = hashPin("482913");
    expect(pinMatches("482913", h)).toBe(true);
    expect(pinMatches("482914", h)).toBe(false);
    expect(pinMatches("482913", "garbage")).toBe(false);
  });
  it("a rep token names the rep and nothing else passes", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(readRepToken(signRepToken(id))).toBe(id);
    expect(readRepToken("not-a-token")).toBeNull();
  });
  it("rep codes are short, lower case and safe to put in a link", () => {
    expect(validRepCode("AB12cd")).toBe("ab12cd");
    expect(validRepCode("../x")).toBeNull();
    expect(validRepCode("")).toBeNull();
  });
  it("a contact needs an email address or a mobile number", () => {
    expect(cleanContact({ full_name: "Pat Example" }).ok).toBe(false);
    expect(cleanContact({ email: "nope" }).ok).toBe(false);
    const c = cleanContact({ full_name: " Pat  Example ", email: "Pat@Example.com", phone: "(212) 555-0142" });
    expect(c.ok && c.value).toMatchObject({ full_name: "Pat Example", email: "pat@example.com", phone_e164: "+12125550142" });
  });
  it("the email says who passed the details on, links the page and the booking, and can be opted out of", () => {
    const rep = { id: "r", code: "ab12cd", full_name: "Sam Rep", company_name: null, email: null, phone_e164: null, active: true };
    const c = cleanContact({ full_name: "Pat Example", email: "pat@example.com" });
    const m = followUpEmail((c as any).value, rep, "tok_1234567890abcdef", "card");
    expect(m.text).toContain("Sam Rep passed your details");
    expect(m.text).toContain("/us-lenders?rep=ab12cd&c=tok_1234567890abcdef");
    expect(m.text).toContain("/book-pgi?rep=ab12cd");
    expect(m.text).toContain("unsubscribe");
    expect(m.html).toContain("/api/v1/field/o/tok_1234567890abcdef.gif");
    expect(followUpSms(rep, "tok_1234567890abcdef")).toContain("Reply STOP");
  });
  it("texts only go out on weekdays in US business hours", () => {
    expect(smsWindowOpen(new Date("2026-11-16T16:00:00Z"))).toBe(true);   // Monday 11am Eastern
    expect(smsWindowOpen(new Date("2026-11-16T03:00:00Z"))).toBe(false);  // Sunday night
    expect(smsWindowOpen(new Date("2026-11-14T16:00:00Z"))).toBe(false);  // Saturday
  });
  it("BI_FIELD_SMS=off stops the follow-up text without asking the database for anything", async () => {
    process.env.BI_FIELD_SMS = "off";
    const query = vi.fn();
    try { expect(await runFollowUpSmsTick({ query } as any, async () => undefined, new Date("2026-11-16T16:00:00Z"))).toEqual({ sent: 0, failed: 0, skipped: true }); }
    finally { delete process.env.BI_FIELD_SMS; }
    expect(query).not.toHaveBeenCalled();
  });
  it("a card reading keeps only what looks right", () => {
    expect(cardFields({ full_name: " Pat  Example ", email: "PAT@EXAMPLE.COM", phone: "212 555 0142", extra: "x" }))
      .toEqual({ full_name: "Pat Example", company_name: "", title: "", email: "pat@example.com", phone: "212 555 0142" });
    expect(cardFields({ email: "not an email", phone: "12" })).toMatchObject({ email: "", phone: "" });
    expect(cardFields(null)).toMatchObject({ full_name: "" });
  });
  it("the rep sees a plain status for each contact", () => {
    expect(contactStatus({ email: "a@b.co", email_sent_at: "x", email_opened_at: "y" })).toBe("Opened the information");
    expect(contactStatus({ email: "a@b.co", email_sent_at: "x", sms_due_at: "y" })).toContain("72 hours");
    expect(contactStatus({ email: null })).toContain("no email address");
  });
});

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("field reps against the database", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/v1/bi", (req, _res, next) => { (req as any).user = { id: null, role: "admin" }; next(); }, fieldStaffRouter);
  app.use("/api/v1", fieldPublicRouter);
  let rep: { id: string; code: string }, pin: string, token: string;
  const made: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const r = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Sam Rep", company_name: "Itest Brokers", email: "sam@itest.local", phone: "2125550100" });
    expect(r.status).toBe(201);
    rep = r.body.rep; pin = r.body.pin; made.push(rep.id);
    expect(pin).toMatch(/^\d{6}$/);
    expect(r.body.page_url).toContain(`/rep/${rep.code}`);
    token = (await request(app).post("/api/v1/field/login").send({ code: rep.code, pin })).body.token;
  });
  afterAll(async () => {
    for (const id of made) { await pool.query(`DELETE FROM bi_field_contacts WHERE rep_id = $1::uuid`, [id]); await pool.query(`DELETE FROM bi_field_reps WHERE id = $1::uuid`, [id]); }
    await pool.end();
  });
  beforeEach(() => { sent.emails.length = 0; sent.mirrors.length = 0; });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it("staff must give a name, and a bad email or phone is refused", async () => {
    expect((await request(app).post("/api/v1/bi/field-reps").send({})).status).toBe(400);
    expect((await request(app).post("/api/v1/bi/field-reps").send({ full_name: "X", email: "nope" })).status).toBe(400);
  });

  it("the wrong PIN is refused, five wrong PINs lock the page, and a new PIN from staff opens it again", async () => {
    const r2 = await request(app).post("/api/v1/bi/field-reps").send({ full_name: "Lock Rep" });
    made.push(r2.body.rep.id);
    const wrong = r2.body.pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect((await request(app).post("/api/v1/field/login").send({ code: r2.body.rep.code, pin: wrong })).status).toBe(401);
    expect((await request(app).post("/api/v1/field/login").send({ code: r2.body.rep.code, pin: r2.body.pin })).status).toBe(429);
    const fresh = await request(app).post(`/api/v1/bi/field-reps/${r2.body.rep.id}/pin`).send({});
    expect(fresh.body.pin).toMatch(/^\d{6}$/);
    expect((await request(app).post("/api/v1/field/login").send({ code: r2.body.rep.code, pin: fresh.body.pin })).status).toBe(200);
  });

  it("nothing on the rep's page works without signing in", async () => {
    expect((await request(app).get("/api/v1/field/me")).status).toBe(401);
    expect((await request(app).post("/api/v1/field/contacts").send({ email: "a@itest.local" })).status).toBe(401);
    expect((await request(app).post("/api/v1/field/scan").send({ image: "x" })).status).toBe(401);
  });

  it("a new contact is logged for the rep, tagged in the CRM, emailed once, and a text is lined up for 72 hours later", async () => {
    const body = { full_name: "Pat Example", company_name: "First Itest Bank", email: "pat@itest.local", phone: "2125550142", source: "card" };
    const a = await request(app).post("/api/v1/field/contacts").set(auth()).send(body);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ created: true, emailed: true });
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0].to).toBe("pat@itest.local");
    expect(sent.mirrors[0].extra_tags).toEqual(["us_lenders", "field_rep", `rep:${rep.code}`]);
    const row = (await pool.query(`SELECT source, sms_due_at, email_sent_at FROM bi_field_contacts WHERE id = $1::uuid`, [a.body.id])).rows[0];
    expect(row.source).toBe("card");
    expect(Math.round((new Date(row.sms_due_at).getTime() - new Date(row.email_sent_at).getTime()) / 3600_000)).toBe(72);

    const again = await request(app).post("/api/v1/field/contacts").set(auth()).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: a.body.id, created: false, emailed: false });
    expect(sent.emails).toHaveLength(1);

    const me = await request(app).get("/api/v1/field/me").set(auth());
    expect(me.body.links.share).toContain(`/us-lenders?rep=${rep.code}`);
    expect(me.body.contacts.find((c: any) => c.id === a.body.id).status).toContain("72 hours");
  });

  it("an unopened email is followed by one text; an opened one is not", async () => {
    const quiet = await request(app).post("/api/v1/field/contacts").set(auth()).send({ full_name: "Quiet One", email: "quiet@itest.local", phone: "2125550143" });
    const reader = await request(app).post("/api/v1/field/contacts").set(auth()).send({ full_name: "Reader One", email: "reader@itest.local", phone: "2125550144" });
    const tok = (await pool.query(`SELECT track_token FROM bi_field_contacts WHERE id = $1::uuid`, [reader.body.id])).rows[0].track_token;
    const gif = await request(app).get(`/api/v1/field/o/${tok}.gif`);
    expect(gif.status).toBe(200);
    expect(gif.headers["content-type"]).toContain("image/gif");
    await pool.query(`UPDATE bi_field_contacts SET sms_due_at = now() - interval '1 hour' WHERE rep_id = $1::uuid AND sms_due_at IS NOT NULL`, [rep.id]);

    const texts: Array<{ to: string; body: string }> = [];
    const monday = new Date(Date.now() + 8 * 24 * 3600_000); monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7)); monday.setUTCHours(16, 0, 0, 0);
    const closed = await runFollowUpSmsTick(pool as any, async (to, b) => { texts.push({ to, body: b }); }, new Date("2026-11-14T16:00:00Z"));
    expect(closed.skipped).toBe(true);
    const out = await runFollowUpSmsTick(pool as any, async (to, b) => { texts.push({ to, body: b }); }, monday);
    const mine = texts.filter((t) => ["+12125550142", "+12125550143", "+12125550144"].includes(t.to));
    expect(mine.map((t) => t.to).sort()).toEqual(["+12125550142", "+12125550143"]);
    expect(mine[0]!.body).toContain(`rep=${rep.code}`);
    expect(out.sent).toBeGreaterThanOrEqual(2);
    texts.length = 0;
    await runFollowUpSmsTick(pool as any, async (to, b) => { texts.push({ to, body: b }); }, monday);
    expect(texts.filter((t) => t.to === "+12125550143")).toHaveLength(0);
    const me = await request(app).get("/api/v1/field/me").set(auth());
    expect(me.body.contacts.find((c: any) => c.id === reader.body.id).status).toBe("Opened the information");
    expect(me.body.contacts.find((c: any) => c.id === quiet.body.id).status).toBe("Emailed, then texted");
  });

  it("a contact with only a mobile number is saved without an email, and a failed email is shown as such", async () => {
    const p = await request(app).post("/api/v1/field/contacts").set(auth()).send({ full_name: "Phone Only", phone: "2125550150" });
    expect(p.body).toMatchObject({ created: true, emailed: false });
    const b = await request(app).post("/api/v1/field/contacts").set(auth()).send({ email: "bounce@itest.local" });
    expect(b.body.emailed).toBe(false);
    const me = await request(app).get("/api/v1/field/me").set(auth());
    expect(me.body.contacts.find((c: any) => c.id === b.body.id).status).toContain("could not be sent");
    expect((await request(app).post("/api/v1/field/contacts").set(auth()).send({ full_name: "Nobody" })).status).toBe(400);
  });

  it("a lead from the rep's QR code is credited to the rep, with no text lined up", async () => {
    await creditLeadToRep(rep.code.toUpperCase(), { name: "qr@itest.local", email: "qr@itest.local", phone: "2125550160" });
    await creditLeadToRep("zzzzzz", { email: "nobody@itest.local" });
    const rows = (await pool.query(`SELECT source, full_name, sms_due_at FROM bi_field_contacts WHERE rep_id = $1::uuid AND email = 'qr@itest.local'`, [rep.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "qr", full_name: null, sms_due_at: null });
    expect((await request(app).get(`/api/v1/field/rep/${rep.code}`)).body.ok).toBe(true);
    expect((await request(app).get(`/api/v1/field/rep/zzzzzz`)).body.ok).toBe(false);
  });

  it("staff see each rep's counts and contacts, and a switched-off rep can no longer sign in", async () => {
    const list = await request(app).get("/api/v1/bi/field-reps");
    const mine = list.body.reps.find((r: any) => r.id === rep.id);
    expect(mine.contacts).toBeGreaterThanOrEqual(4);
    expect(mine.opened).toBe(1);
    const contacts = await request(app).get(`/api/v1/bi/field-reps/${rep.id}/contacts`);
    expect(contacts.body.contacts.length).toBe(mine.contacts);
    await request(app).patch(`/api/v1/bi/field-reps/${rep.id}`).send({ active: false });
    expect((await request(app).get("/api/v1/field/me").set(auth())).status).toBe(401);
    expect((await request(app).post("/api/v1/field/login").send({ code: rep.code, pin })).status).toBe(401);
  });

  it("a card photo that is not a photo is refused", async () => {
    await request(app).patch(`/api/v1/bi/field-reps/${rep.id}`).send({ active: true });
    expect((await request(app).post("/api/v1/field/scan").set(auth()).send({ image: "hello" })).status).toBe(400);
  });
});
