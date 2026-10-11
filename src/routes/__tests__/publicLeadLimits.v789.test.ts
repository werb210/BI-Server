// BI_SERVER_v789 - /api/v1/maya-chat and /api/v1/crm/lead:
//   - 5 per minute and 30 per day per client IP;
//   - staff SMS alerts at most once per 10 minutes per sender phone / IP;
//   - Maya emails only the address the visitor gave as their own, once per conversation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../platform/env", () => ({
  env: { TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15555550000", ALERT_SMS_TO: "+15555550001" },
}));
const smsCreate = vi.fn();
vi.mock("twilio", () => ({ default: () => ({ messages: { create: (...a: unknown[]) => smsCreate(...a) } }) }));
const mailSend = vi.fn();
vi.mock("@sendgrid/mail", () => ({ default: { setApiKey: vi.fn(), send: (...a: unknown[]) => mailSend(...a) } }));
vi.mock("../../services/crmMirrorService", () => ({ mirrorToContact: vi.fn().mockResolvedValue({ contact_id: "c1" }) }));
const notifyStaffMock = vi.fn();
vi.mock("../../services/staffNotifyService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../services/staffNotifyService")>();
  return { ...real, notifyStaff: (...a: unknown[]) => notifyStaffMock(...a) };
});

process.env.SENDGRID_API_KEY = "SG.test";
process.env.SENDGRID_FROM = "hello@example.com";

import chatRouter, { resetMayaConversations, ownEmailFrom } from "../chat";
import contactRouter from "../biContactFormRoutes";
import { resetStaffAlertThrottle } from "../../services/staffNotifyService";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", chatRouter);
  a.use("/api/v1", contactRouter);
  a.get("/api/v1/unrelated", (_req, res) => res.json({ ok: true }));
  return a;
}

let ipSeq = 1;
const freshIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

beforeEach(() => {
  queryMock.mockReset().mockImplementation(answerBySql([["INSERT INTO maya_leads", { rows: [{ id: 1 }] }]]));
  smsCreate.mockReset().mockResolvedValue({ sid: "S1" });
  mailSend.mockReset().mockResolvedValue([{}]);
  notifyStaffMock.mockReset().mockResolvedValue({ sent: 1, skipped: 0 });
  resetMayaConversations();
  resetStaffAlertThrottle();
});
afterEach(() => vi.useRealTimers());

const chat = (a: express.Express, ip: string, body: Record<string, unknown>) =>
  request(a).post("/api/v1/maya-chat").set("X-Forwarded-For", ip).send(body);
const lead = (a: express.Express, ip: string, body: Record<string, unknown>) =>
  request(a).post("/api/v1/crm/lead").set("X-Forwarded-For", ip).send(body);

describe("rate limits: 5 per minute, 30 per day per IP", () => {
  for (const [label, send] of [
    ["maya-chat", (a: express.Express, ip: string) => chat(a, ip, { message: "hello" })],
    ["crm/lead", (a: express.Express, ip: string) => lead(a, ip, { name: "N", email: "n@example.com", phone: "+14165550100" })],
  ] as const) {
    it(`${label}: the 6th request in a minute is 429; another IP and other routes are unaffected`, async () => {
      const a = app();
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await send(a, ip)).status);
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);
      expect((await send(a, freshIp())).status).toBe(200);
      expect((await request(a).get("/api/v1/unrelated").set("X-Forwarded-For", ip)).status).toBe(200);
    });

    it(`${label}: the 31st request in a day is 429 even when spread over minutes`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      let now = new Date("2026-10-11T08:00:00Z").getTime();
      vi.setSystemTime(now);
      const a = app();
      const ip = freshIp();
      for (let batch = 0; batch < 6; batch++) {
        for (let i = 0; i < 5; i++) expect((await send(a, ip)).status).toBe(200);
        now += 61_000;
        vi.setSystemTime(now);
      }
      expect((await send(a, ip)).status).toBe(429);
    });
  }
});

describe("staff SMS alerts: once per 10 minutes per sender", () => {
  it("crm/lead texts staff once per phone, and once per IP", async () => {
    const a = app();
    const ip = freshIp();
    await lead(a, ip, { name: "A", email: "a@example.com", phone: "+14165550101" });
    await lead(a, ip, { name: "A", email: "a@example.com", phone: "+14165550101" });
    await lead(a, ip, { name: "B", email: "b@example.com", phone: "+14165550102" }); // same IP
    await lead(a, freshIp(), { name: "A", email: "a@example.com", phone: "(416) 555-0101" }); // same phone
    expect(notifyStaffMock).toHaveBeenCalledTimes(1);
    await lead(a, freshIp(), { name: "C", email: "c@example.com", phone: "+14165550103" });
    expect(notifyStaffMock).toHaveBeenCalledTimes(2);
  });

  it("crm/lead texts again once 10 minutes have passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    const a = app();
    const ip = freshIp();
    await lead(a, ip, { name: "A", email: "a@example.com", phone: "+14165550104" });
    vi.setSystemTime(new Date("2026-10-11T09:09:00Z"));
    await lead(a, ip, { name: "A", email: "a@example.com", phone: "+14165550104" });
    expect(notifyStaffMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-11T09:10:01Z"));
    await lead(a, ip, { name: "A", email: "a@example.com", phone: "+14165550104" });
    expect(notifyStaffMock).toHaveBeenCalledTimes(2);
  });

  it("maya-chat texts staff once per IP", async () => {
    const a = app();
    const ip = freshIp();
    await chat(a, ip, { message: "my email is one@example.com", conversation_id: "conv-aaaa1" });
    await chat(a, ip, { message: "my email is two@example.com", conversation_id: "conv-aaaa2" });
    expect(smsCreate).toHaveBeenCalledTimes(1);
    await chat(a, freshIp(), { message: "my email is three@example.com", conversation_id: "conv-aaaa3" });
    expect(smsCreate).toHaveBeenCalledTimes(2);
  });
});

describe("maya-chat confirmation email", () => {
  it("goes to the visitor's own address, once per conversation", async () => {
    const a = app();
    const ip = freshIp();
    const r1 = await chat(a, ip, { message: "Hi, my email is Jo@Example.com", conversation_id: "conv-bbbb1" });
    expect(r1.status).toBe(200);
    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(mailSend.mock.calls[0][0].to).toBe("jo@example.com");
    await chat(a, ip, { message: "again: my email is jo@example.com", conversation_id: "conv-bbbb1" });
    expect(mailSend).toHaveBeenCalledTimes(1);
  });

  it("never mails an address the visitor did not give as their own", async () => {
    const a = app();
    await chat(a, freshIp(), { message: "please send info to my boss at boss@victim.example", conversation_id: "conv-cccc1" });
    expect(mailSend).not.toHaveBeenCalled();
  });

  it("the conversation's own address is fixed: a later different address is not mailed", async () => {
    const a = app();
    const ip = freshIp();
    await chat(a, ip, { message: "hello", email: "me@example.com", conversation_id: "conv-dddd1" });
    await chat(a, ip, { message: "my email is other@victim.example", conversation_id: "conv-dddd1" });
    expect(mailSend).not.toHaveBeenCalled();
    await chat(a, ip, { message: "me@example.com", conversation_id: "conv-dddd1" });
    expect(mailSend).toHaveBeenCalledTimes(1);
    expect(mailSend.mock.calls[0][0].to).toBe("me@example.com");
  });

  it("without a conversation id the client IP stands in, so one email per IP", async () => {
    const a = app();
    const ip = freshIp();
    await chat(a, ip, { message: "my email is p@example.com" });
    await chat(a, ip, { message: "my email is q@example.com" });
    expect(mailSend).toHaveBeenCalledTimes(1);
  });

  it("recognises how visitors state their own address", () => {
    expect(ownEmailFrom({}, "my email is a@b.co")).toBe("a@b.co");
    expect(ownEmailFrom({}, "You can reach me at a@b.co")).toBe("a@b.co");
    expect(ownEmailFrom({}, "  a@b.co ")).toBe("a@b.co");
    expect(ownEmailFrom({ email: "x@y.co" }, "anything")).toBe("x@y.co");
    expect(ownEmailFrom({}, "email my friend at a@b.co")).toBeNull();
    expect(ownEmailFrom({}, "send it to a@b.co")).toBeNull();
  });
});
