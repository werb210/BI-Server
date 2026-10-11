// BI_SERVER_v784_OCT11_AUDIT - regression tests for the Oct 11 audit fixes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import twilio from "twilio";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { answerBySql } from "./helpers/answerBySql";
import { createSendgridSigner } from "./helpers/sendgridSign";

const queryMock = vi.fn();
vi.mock("../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: async () => ({ query: (...args: unknown[]) => queryMock(...args), release: () => undefined }),
    end: async () => undefined,
  },
  runMigrations: async () => undefined,
}));

import app from "../server";
import { requireAuth, isStaffOrServiceClaims } from "../platform/auth";
import { getJwtSecret, assertJwtSecretAtStartup } from "../platform/jwtSecret";
import { authApplicant } from "../routes/applicantAuth";
import sendgridRoutes from "../routes/biSendgridWebhookRoutes";
import smsInboundRoutes from "../routes/biSmsInboundRoutes";
import { revokeLenderApiKey } from "../services/lenderApiKeyRevoke";

const SECRET = process.env.JWT_SECRET as string;
const sign = (claims: Record<string, unknown>) => jwt.sign(claims, SECRET);
const bearer = (claims: Record<string, unknown>) => `Bearer ${sign(claims)}`;

const LENDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LENDER_ID = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("1. staff-only requireAuth", () => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    ["BI applicant OTP token", { kind: "applicant", phone: "+15875551234" }],
    ["BF client token", { sub: "client-1", role: "Client" }],
    ["tracked-link token", { sid: "s-1", u: "u-1" }],
    ["no-role token", { sub: "someone" }],
    ["lender token", { kind: "lender", id: LENDER_ID }],
    ["legacy lender role token", { staffUserId: "u-1", role: "lender" }],
    ["referrer token", { kind: "referrer", id: "ref-1" }],
    ["applicant kind with staff role", { kind: "applicant", role: "Admin", phone: "+15875551234" }],
  ];
  it.each(rejected)("rejects a %s with 403 on a staff route", async (_label, claims) => {
    const r = await request(app).get("/api/v1/bi/applications").set("Authorization", bearer(claims));
    expect(r.status).toBe(403);
  });

  it("rejects an applicant token on commissions, payouts and CRM", async () => {
    const auth = bearer({ kind: "applicant", phone: "+15875551234" });
    for (const [method, path] of [
      ["post", "/api/v1/bi/commissions/premium-received"],
      ["post", "/api/v1/bi/commissions/paid"],
      ["post", "/api/v1/bi/payouts/pay"],
      ["get", "/api/v1/bi/crm/contacts"],
    ] as const) {
      const r = await (request(app) as any)[method](path).set("Authorization", auth).send({});
      expect(r.status, path).toBe(403);
    }
  });

  const accepted: Array<[string, Record<string, unknown>]> = [
    ["BF Admin", { sub: "staff-1", role: "Admin" }],
    ["BF Staff", { sub: "staff-2", role: "Staff" }],
    ["BF Ops", { sub: "staff-3", role: "Ops" }],
    ["BF Marketing", { sub: "staff-4", role: "Marketing" }],
    ["BI owner", { staffUserId: "owner-1", role: "owner" }],
    ["service token", { kind: "service", source: "bf-server" }],
    ["BF-Server carrier-submit token", { sub: "bf-server", scope: "bi:service" }],
  ];
  it.each(accepted)("accepts a %s", async (_label, claims) => {
    const r = await request(app).get("/api/v1/bi/me").set("Authorization", bearer(claims));
    expect(r.status).toBe(200);
  });

  it("still answers 401 for a missing or forged token", async () => {
    expect((await request(app).get("/api/v1/bi/me")).status).toBe(401);
    const forged = jwt.sign({ sub: "x", role: "Admin" }, "not-the-secret-at-all");
    expect((await request(app).get("/api/v1/bi/me").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("classifies claims without touching a request", () => {
    expect(isStaffOrServiceClaims({ role: "admin" })).toBe(true);
    expect(isStaffOrServiceClaims({ role: "client" })).toBe(false);
    expect(isStaffOrServiceClaims({ sub: "bf-server", scope: "other" })).toBe(false);
    expect(isStaffOrServiceClaims("a-string-payload")).toBe(false);
  });

  // v789: behaviour instead of reading server.ts.
  it("does not mount requireAuth on the bare /api/v1 prefix", async () => {
    // An unknown /api/v1 path falls through every router to 404; a bare
    // requireAuth mount would answer 401 first.
    const r = await request(app).get("/api/v1/definitely-not-a-route-v789");
    expect(r.status).toBe(404);
  });

  it("mounts the lender API above every staff /api/v1/bi mount", async () => {
    // A lender token on a lender route under /api/v1/bi must reach the lender
    // auth, not the staff-only requireAuth (which answers 403 staff_only).
    const r = await request(app)
      .get("/api/v1/bi/lender/applications")
      .set("Authorization", bearer({ kind: "lender", id: LENDER_ID }));
    expect(r.body?.error).not.toBe("staff_only");
  });
});

describe("1b. applicant, lender and public routes keep working with their own tokens", () => {
  it("accepts an applicant token on an applicant route", async () => {
    const r = await request(app)
      .post("/api/v1/applicants/profile")
      .set("Authorization", bearer({ kind: "applicant", phone: "+15875551234" }))
      .send({});
    expect([401, 403]).not.toContain(r.status);
  });

  it("authApplicant passes an applicant token through", async () => {
    const a = express();
    a.get("/x", authApplicant, (req: any, res) => res.json({ phone: req.applicantPhone }));
    const r = await request(a).get("/x").set("Authorization", bearer({ kind: "applicant", phone: "+15875551234" }));
    expect(r.status).toBe(200);
    expect(r.body.phone).toBe("+15875551234");
  });

  it("accepts a legacy applicant token on the applicant draft route", async () => {
    const r = await request(app)
      .post("/api/v1/bi/application/draft")
      .set("Authorization", bearer({ staffUserId: "u-1", role: "applicant", phone: "+15875551234" }))
      .send({ data: {} });
    expect([401, 403]).not.toContain(r.status);
  });

  it("no longer blocks the public contact form with requireAuth", async () => {
    const r = await request(app).post("/api/v1/crm/lead").send({});
    expect(r.status).not.toBe(401);
  });

  it("accepts a lender token on /api/v1/bi/lender routes", async () => {
    const r = await request(app).get("/api/v1/bi/lender/api-keys").set("Authorization", bearer({ kind: "lender", id: LENDER_ID }));
    expect(r.status).toBe(200);
  });

  it("accepts a lender token on /api/v1/lender routes", async () => {
    const r = await request(app).get("/api/v1/lender/api-keys").set("Authorization", bearer({ kind: "lender", id: LENDER_ID }));
    expect(r.status).toBe(200);
  });
});

describe("2. no JWT secret fallback", () => {
  const literal = ["dev", "missing", "jwt", "secret"].join("-");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { if (entry !== "node_modules") out.push(...walk(p)); }
      else if (/\.(ts|js|mjs)$/.test(entry)) out.push(p);
    }
    return out;
  }

  it("the fallback literal appears nowhere in src", () => {
    const hits = walk("src").filter((f) => readFileSync(f, "utf8").includes(literal));
    expect(hits).toEqual([]);
  });

  describe("with JWT_SECRET unset", () => {
    let saved: string | undefined;
    let savedNodeEnv: string | undefined;
    beforeEach(() => { saved = process.env.JWT_SECRET; savedNodeEnv = process.env.NODE_ENV; delete process.env.JWT_SECRET; });
    afterEach(() => { process.env.JWT_SECRET = saved; process.env.NODE_ENV = savedNodeEnv; vi.restoreAllMocks(); });

    it("getJwtSecret throws instead of falling back", () => {
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    });

    it("a token signed with the old literal is refused", async () => {
      const a = express();
      a.get("/staff", requireAuth, (_req, res) => res.json({ ok: true }));
      a.get("/applicant", authApplicant, (_req, res) => res.json({ ok: true }));
      expect((await request(a).get("/staff").set("Authorization", `Bearer ${jwt.sign({ role: "Admin" }, literal)}`)).status).not.toBe(200);
      expect((await request(a).get("/applicant").set("Authorization", `Bearer ${jwt.sign({ kind: "applicant", phone: "+15875551234" }, literal)}`)).status).toBe(401);
    });

    it("startup exits 1 outside tests", () => {
      process.env.NODE_ENV = "production";
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      assertJwtSecretAtStartup();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("startup does not exit when NODE_ENV=test", () => {
      process.env.NODE_ENV = "test";
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      assertJwtSecretAtStartup();
      expect(exit).not.toHaveBeenCalled();
    });
  });

  it("index.ts runs the startup check", () => {
    expect(readFileSync("src/index.ts", "utf8")).toContain("assertJwtSecretAtStartup()");
  });
});

describe("4. SendGrid webhook", () => {
  const signer = createSendgridSigner();
  const body = JSON.stringify([{ email: "a@example.com", event: "delivered" }]);
  function hookApp() { const a = express(); a.use(sendgridRoutes); return a; }
  afterEach(() => { delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY; vi.restoreAllMocks(); });

  it("answers 503 with an error log when the public key is unset", async () => {
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await request(hookApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(body);
    expect(r.status).toBe(503);
    expect(err).toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("403s an unsigned event", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64;
    const r = await request(hookApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").send(body);
    expect(r.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("403s a bad signature", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64;
    const headers = signer.sign(JSON.stringify([{ email: "other@example.com", event: "bounce" }]));
    const r = await request(hookApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").set(headers).send(body);
    expect(r.status).toBe(403);
  });

  it("accepts a correctly signed event", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64;
    const r = await request(hookApp()).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").set(signer.sign(body)).send(body);
    expect(r.status).toBe(200);
  });
});

describe("5. Twilio inbound SMS signature", () => {
  const TOKEN = "twilio-test-auth-token";
  const params = { From: "+15875551234", Body: "STOP" };
  const path = "/bi/twilio/sms-inbound";
  function smsApp() { const a = express(); a.set("trust proxy", 1); a.use(smsInboundRoutes); return a; }
  function form() { return new URLSearchParams(params).toString(); }
  afterEach(() => { delete process.env.TWILIO_AUTH_TOKEN; delete process.env.BI_PUBLIC_BASE_URL; vi.restoreAllMocks(); });

  it("503s with a log when TWILIO_AUTH_TOKEN is unset", async () => {
    const r = await request(smsApp()).post(path).type("form").send(form());
    expect(r.status).toBe(503);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("403s a missing signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    const r = await request(smsApp()).post(path).type("form").send(form());
    expect(r.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("403s a bad signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    const sig = twilio.getExpectedTwilioSignature("wrong-token", `https://bi.example.com${path}`, params);
    const r = await request(smsApp()).post(path).set("X-Twilio-Signature", sig).set("X-Forwarded-Host", "bi.example.com").set("X-Forwarded-Proto", "https").type("form").send(form());
    expect(r.status).toBe(403);
  });

  it("accepts a signature over BI_PUBLIC_BASE_URL", async () => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.BI_PUBLIC_BASE_URL = "https://api.boreal.insure/";
    const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://api.boreal.insure${path}`, params);
    const r = await request(smsApp()).post(path).set("X-Twilio-Signature", sig).type("form").send(form());
    expect(r.status).toBe(200);
    expect(queryMock).toHaveBeenCalled();
  });

  it("accepts a signature over the forwarded proto/host URL", async () => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://bi.example.com${path}`, params);
    const r = await request(smsApp()).post(path).set("X-Twilio-Signature", sig).set("X-Forwarded-Host", "bi.example.com").set("X-Forwarded-Proto", "https").type("form").send(form());
    expect(r.status).toBe(200);
  });
});

describe("6. process exits", () => {
  const index = readFileSync("src/index.ts", "utf8");
  it("uncaughtException logs and exits 1", () => {
    expect(index).toMatch(/process\.on\("uncaughtException",[\s\S]*?logger\.error[\s\S]*?process\.exit\(1\);\s*\}\);/);
  });
  it("a listen failure exits 1", () => {
    expect(index).toMatch(/server\.on\("error",[\s\S]*?process\.exit\(1\)/);
  });
});

describe("7. GET/PATCH /api/v1/bi/me", () => {
  const staff = () => bearer({ sub: "staff-9", role: "Staff", email: "token@example.com" });

  it("GET returns full_name, email and phone_e164 from bi_staff_profile", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_staff_profile", { rows: [{ full_name: "Pat Lee", email: "pat@example.com", phone_e164: "+15875551234" }] }]]));
    const r = await request(app).get("/api/v1/bi/me").set("Authorization", staff());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ full_name: "Pat Lee", email: "pat@example.com", phone_e164: "+15875551234" });
  });

  it("PATCH writes only the three fields with bound parameters", async () => {
    queryMock.mockImplementation(answerBySql([["INSERT INTO bi_staff_profile", (_sql: string, p: unknown[]) => ({ rows: [{ full_name: p[1], email: p[2], phone_e164: p[3] }], rowCount: 1 })]]));
    const r = await request(app).patch("/api/v1/bi/me").set("Authorization", staff())
      .send({ full_name: "  Robert'); DROP TABLE x;--  ", email: "Rob@Example.com", phone_e164: "+15875550000" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ email: "rob@example.com", phone_e164: "+15875550000" });
    const call = queryMock.mock.calls.find((c) => String(c[0]).includes("INSERT INTO bi_staff_profile"))!;
    expect(String(call[0])).not.toContain("DROP TABLE");
    expect(call[1]).toEqual(["staff-9", "Robert'); DROP TABLE x;--", "rob@example.com", "+15875550000", true, true, true]);
  });

  it("PATCH rejects other fields", async () => {
    const r = await request(app).patch("/api/v1/bi/me").set("Authorization", staff()).send({ full_name: "A", role: "admin" });
    expect(r.status).toBe(400);
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes("bi_staff_profile"))).toBe(false);
  });

  it.each([
    [{ email: "not-an-email" }],
    [{ phone_e164: "5875551234" }],
    [{ full_name: "" }],
    [{ full_name: 42 }],
    [{}],
  ])("PATCH validates %j", async (body) => {
    const r = await request(app).patch("/api/v1/bi/me").set("Authorization", staff()).send(body);
    expect(r.status).toBe(400);
  });

  it("PATCH is staff only", async () => {
    expect((await request(app).patch("/api/v1/bi/me").set("Authorization", bearer({ kind: "applicant", phone: "+15875551234" })).send({ full_name: "A" })).status).toBe(403);
    expect((await request(app).patch("/api/v1/bi/me").set("Authorization", bearer({ kind: "service", source: "bf-server" })).send({ full_name: "A" })).status).toBe(403);
  });
});

describe("8. lender API key revoke", () => {
  function keyStore(owner: string, active = true) {
    return answerBySql([
      [/UPDATE bi_lender_api_keys/, (_s: string, p: unknown[]) => (p[0] === KEY_ID && p[1] === owner && active ? { rows: [{ id: KEY_ID }], rowCount: 1 } : { rows: [], rowCount: 0 })],
      [/SELECT id FROM bi_lender_api_keys/, (_s: string, p: unknown[]) => (p[0] === KEY_ID && p[1] === owner ? { rows: [{ id: KEY_ID }], rowCount: 1 } : { rows: [], rowCount: 0 })],
    ]);
  }

  it("a lender revokes its own key", async () => {
    queryMock.mockImplementation(keyStore(LENDER_ID));
    const r = await request(app).post(`/api/v1/lender/api-keys/${KEY_ID}/revoke`).set("Authorization", bearer({ kind: "lender", id: LENDER_ID }));
    expect(r.status).toBe(200);
    expect(r.body.revoked).toBe(true);
  });

  it("another lender's key answers 404", async () => {
    queryMock.mockImplementation(keyStore(OTHER_LENDER_ID));
    const r = await request(app).post(`/api/v1/lender/api-keys/${KEY_ID}/revoke`).set("Authorization", bearer({ kind: "lender", id: LENDER_ID }));
    expect(r.status).toBe(404);
  });

  it("requires lender auth", async () => {
    expect((await request(app).post(`/api/v1/lender/api-keys/${KEY_ID}/revoke`)).status).toBe(401);
  });

  it("the service distinguishes revoked, already revoked and not found", async () => {
    queryMock.mockImplementation(keyStore(LENDER_ID));
    expect(await revokeLenderApiKey(LENDER_ID, KEY_ID)).toBe("revoked");
    queryMock.mockImplementation(keyStore(LENDER_ID, false));
    expect(await revokeLenderApiKey(LENDER_ID, KEY_ID)).toBe("already_revoked");
    expect(await revokeLenderApiKey(OTHER_LENDER_ID, KEY_ID)).toBe("not_found");
    expect(await revokeLenderApiKey(LENDER_ID, "not-a-uuid")).toBe("not_found");
  });

  it("the staff revoke route uses the shared service", async () => {
    const src = readFileSync("src/routes/biAdminLenderRoutes.ts", "utf8");
    expect(src).toContain("revokeLenderApiKey(req.params.id, req.params.keyId)");
    queryMock.mockImplementation(keyStore(LENDER_ID));
    const r = await request(app).post(`/api/v1/bi/admin/lenders/${LENDER_ID}/api-keys/${KEY_ID}/revoke`).set("Authorization", bearer({ sub: "admin-1", role: "Admin" }));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ revoked: true });
  });
});
