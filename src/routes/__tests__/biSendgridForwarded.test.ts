// BI_SENDGRID_EVENTS_v1 - events passed on by BF-Server: only BI's own are handled.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

import webhookRoutes from "../biSendgridWebhookRoutes";
import { createSendgridSigner } from "../../__tests__/helpers/sendgridSign";

const signer = createSendgridSigner();
const app = express();
app.use(webhookRoutes);
function post(payload: unknown, forwarded: boolean) {
  const raw = JSON.stringify(payload);
  const r = request(app).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").set(signer.sign(raw));
  return (forwarded ? r.set("X-Boreal-Forwarded-By", "bf-server") : r).send(raw);
}
const ledgerEmails = () => queryMock.mock.calls.filter((c) => /INSERT INTO bi_marketing_send_events/.test(String(c[0]))).map((c) => (c[1] as unknown[])[2]);
const suppressions = () => queryMock.mock.calls.filter((c) => /INSERT INTO bi_suppressions/.test(String(c[0])));

describe("forwarded SendGrid batches", () => {
  beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue({ rowCount: 1, rows: [] }); process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64; });

  it("keeps flow and bi_mkt events, drops Boreal Financial ones", async () => {
    await post([
      { email: "lender@bank.test", event: "open", job_id: "flow:cf53f3ce-5157-4f40-b536-b2ed836aa18e:e1", contact_id: "c1" },
      { email: "broker@co.test", event: "click", bi_mkt: "1", url: "https://boreal.insure" },
      { email: "client@bf.test", event: "unsubscribe" },
    ], true).expect(200);
    expect(ledgerEmails()).toEqual(["lender@bank.test", "broker@co.test"]);
    expect(suppressions()).toHaveLength(0);
  });

  it("a direct (unforwarded) batch still handles everything except Keystone mail", async () => {
    await post([{ email: "dead@x.test", event: "bounce", type: "bounce" }, { email: "ks@x.test", event: "open", ks_mkt: "1" }], false).expect(200);
    expect(ledgerEmails()).toEqual(["dead@x.test"]);
    expect(suppressions()).toHaveLength(1);
  });
});

// BI_SENDGRID_FORWARD_AUTH_v1
import crypto from "node:crypto";
describe("forwarded batches signed with the shared secret", () => {
  beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue({ rowCount: 1, rows: [] }); process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64; process.env.JWT_SECRET = "shared-secret-for-tests"; });
  const send = (sig: string) => {
    const raw = JSON.stringify([{ email: "lender@bank.test", event: "open", job_id: "flow:cf53f3ce-5157-4f40-b536-b2ed836aa18e:e1" }]);
    const ts = String(Math.floor(Date.now() / 1000));
    const fsig = sig === "good" ? crypto.createHmac("sha256", "shared-secret-for-tests").update(`${ts}.${raw}`).digest("hex") : "deadbeef";
    return request(app).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json")
      .set("X-Twilio-Email-Event-Webhook-Signature", "not-a-sendgrid-signature").set("X-Twilio-Email-Event-Webhook-Timestamp", ts)
      .set("X-Boreal-Forwarded-By", "bf-server").set("X-Boreal-Forward-Signature", fsig).send(raw);
  };
  it("accepts a forward BF-Server signed, even when SendGrid's signature does not match this key", async () => {
    await send("good").expect(200);
    expect(ledgerEmails()).toEqual(["lender@bank.test"]);
  });
  it("refuses a forward with a wrong shared-secret signature", async () => {
    await send("bad").expect(403);
    expect(ledgerEmails()).toEqual([]);
  });
});
