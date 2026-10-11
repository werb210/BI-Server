// BI_SERVER_v789_LOG_MASKING - phone numbers (last 4) and email addresses
// (first letter + domain) are masked in the failure logs of the SendGrid
// webhook and the inbound SMS route.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
const logs = vi.hoisted(() => ({ error: [] as unknown[][] }));
vi.mock("../../platform/logger", () => ({
  logger: { error: (...a: unknown[]) => { logs.error.push(a); }, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../middleware/twilioSignature", () => ({
  requireTwilioSignature: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import sendgridRoutes from "../biSendgridWebhookRoutes";
import smsInboundRoutes from "../biSmsInboundRoutes";
import { createSendgridSigner } from "../../__tests__/helpers/sendgridSign";
import { maskEmail, maskPhone, truncateForLog } from "../../util/mask";

const signer = createSendgridSigner();
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs.error.length = 0;
  poolQuery.mockReset().mockRejectedValue(new Error("db down"));
  process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
});

describe("mask helpers", () => {
  it("masks a phone to its last 4 digits and an email to first letter + domain", () => {
    expect(maskPhone("+1 (587) 555-1234")).toBe("***1234");
    expect(maskEmail("Jane.Doe@example.com")).toBe("J***@example.com");
    expect(truncateForLog("x".repeat(600)).startsWith("x".repeat(500))).toBe(true);
    expect(truncateForLog("x".repeat(600)).length).toBeLessThan(540);
  });
});

describe("SendGrid webhook failure logs mask the address", () => {
  it("ledger, click and suppression failures log j***@domain, never the address", async () => {
    const raw = JSON.stringify([
      { email: "dead.address@example.com", event: "bounce", type: "bounce" },
      { email: "clicker@example.com", event: "click", url: "https://x.test/a" },
    ]);
    const a = express();
    a.use(sendgridRoutes);
    const r = await request(a).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").set(signer.sign(raw)).send(raw);
    expect(r.status).toBe(200);
    const text = JSON.stringify(warn.mock.calls);
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain("d***@example.com");
    expect(text).toContain("c***@example.com");
    expect(text).not.toContain("dead.address@");
    expect(text).not.toContain("clicker@");
  });
});

describe("inbound SMS failure logs mask the phone", () => {
  it("logs ***1234, never the full number", async () => {
    const a = express();
    a.use(smsInboundRoutes);
    const r = await request(a).post("/bi/twilio/sms-inbound").type("form").send({ From: "+15875551234", Body: "STOP" });
    expect(r.status).toBe(200);
    expect(logs.error).toHaveLength(1);
    expect((logs.error[0]![0] as { from: string }).from).toBe("***1234");
    expect(JSON.stringify(logs.error)).not.toContain("5875551234");
    const r2 = await request(a).post("/bi/twilio/sms-inbound").type("form").send({ From: "+15875559876", Body: "hello" });
    expect(r2.status).toBe(200);
    expect((logs.error[1]![0] as { from: string }).from).toBe("***9876");
  });
});
