// BI_SERVER_v789 items 31-34: internal service routes, application notes,
// company activity, contact duplicates/merge/documents. The test app mounts
// the routers exactly as server.ts does (same paths, same middleware order,
// the real requireAuth), with the database mocked by SQL content.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
vi.mock("../../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: async () => ({ query: (...args: unknown[]) => clientQueryMock(...args), release: releaseMock }),
  },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { requireAuth } from "../../platform/auth";
import biInternalServiceRoutes from "../biInternalServiceRoutes";
import biCrmRoutes from "../biCrmRoutes";
import biCompanyActivityRoutes from "../biCompanyActivityRoutes";
import biContactMergeRoutes from "../biContactMergeRoutes";
import biOutreachCrmRoutes from "../biOutreachCrmRoutes";
import biNotesRoutes from "../biNotesRoutes";
import { answerBySql, callsMatching, rejects, sqlText } from "../../__tests__/helpers/answerBySql";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Above the staff gate, as server.ts must mount it.
  app.use("/api/v1/bi/internal", biInternalServiceRoutes);
  // Stand-in for the early `app.use("/api/v1/bi", ..., requireAuth, biRoutes)` mount.
  app.use("/api/v1/bi", requireAuth, Router());
  app.use("/api/v1/bi", requireAuth, biCrmRoutes);
  app.use("/api/v1/bi", requireAuth, biCompanyActivityRoutes);
  app.use("/api/v1/bi", requireAuth, biContactMergeRoutes);
  app.use("/api/v1/bi", biOutreachCrmRoutes);
  app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
  return app;
}

const secret = () => process.env.JWT_SECRET as string;
const staffToken = () => jwt.sign({ staffUserId: "staff-1", role: "staff", email: "ann@example.com" }, secret());
const applicantToken = () => jwt.sign({ kind: "applicant", phone: "+14165551234" }, secret());
const bfServiceToken = () => jwt.sign({ kind: "service", source: "bf-server" }, secret());
const bfCarrierToken = () => jwt.sign({ sub: "bf-server", scope: "bi:service" }, secret());
const biServiceToken = () => jwt.sign({ kind: "service", source: "bi-server" }, secret());

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const SECRET_TEXT = "relation secret_internal_table does not exist";

function call(method: "get" | "post", path: string, token?: string, body?: unknown) {
  let r = (request(makeApp()) as any)[method](path);
  if (token) r = r.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) r = r.send(body);
  return r as request.Test;
}

let savedServiceSecret: string | undefined;
beforeEach(() => {
  savedServiceSecret = process.env.BI_SERVICE_JWT_SECRET;
  delete process.env.BI_SERVICE_JWT_SECRET;
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  queryMock.mockImplementation(answerBySql([]));
  clientQueryMock.mockImplementation(answerBySql([]));
});
afterEach(() => {
  if (savedServiceSecret === undefined) delete process.env.BI_SERVICE_JWT_SECRET;
  else process.env.BI_SERVICE_JWT_SECRET = savedServiceSecret;
});

// ---------------------------------------------------------------- [31] internal

describe("[31] /api/v1/bi/internal auth", () => {
  const routes: Array<["get" | "post", string, unknown?]> = [
    ["post", "/api/v1/bi/internal/outreach/advance", { match: { id: ID }, to: "contacted" }],
    ["get", `/api/v1/bi/internal/outreach/contacts/${ID}`],
  ];
  for (const [method, path, body] of routes) {
    it(`${method.toUpperCase()} ${path}: 401 without a token`, async () => {
      expect((await call(method, path, undefined, body)).status).toBe(401);
    });
    it(`${method.toUpperCase()} ${path}: 401 with a garbage token`, async () => {
      expect((await call(method, path, "not-a-jwt", body)).status).toBe(401);
    });
    it(`${method.toUpperCase()} ${path}: 403 for staff, applicant and non-BF service tokens`, async () => {
      expect((await call(method, path, staffToken(), body)).status).toBe(403);
      expect((await call(method, path, applicantToken(), body)).status).toBe(403);
      expect((await call(method, path, biServiceToken(), body)).status).toBe(403);
      expect(queryMock).not.toHaveBeenCalled();
    });
  }
  it("accepts both BF-Server service token shapes", async () => {
    queryMock.mockImplementation(answerBySql([[/UPDATE bi_contacts/, { rows: [], rowCount: 1 }]]));
    expect((await call("post", "/api/v1/bi/internal/outreach/advance", bfServiceToken(), { match: { id: ID }, to: "contacted" })).status).toBe(200);
    expect((await call("post", "/api/v1/bi/internal/outreach/advance", bfCarrierToken(), { match: { id: ID }, to: "contacted" })).status).toBe(200);
  });
});

describe("[31] POST /internal/outreach/advance", () => {
  const advance = (body: unknown) => call("post", "/api/v1/bi/internal/outreach/advance", bfServiceToken(), body);

  it("400 on a bad `to`, missing match, or no usable match keys", async () => {
    expect((await advance({ match: { id: ID }, to: "lender" })).status).toBe(400);
    expect((await advance({ match: { id: ID } })).status).toBe(400);
    expect((await advance({ to: "contacted" })).status).toBe(400);
    expect((await advance({ match: {}, to: "contacted" })).status).toBe(400);
    expect((await advance({ match: { id: "nope" }, to: "contacted" })).status).toBe(400);
    expect((await advance({ match: { phone: "555-12" }, to: "contacted" })).status).toBe(400);
    expect((await advance({ match: { email: "not-an-email" }, to: "contacted" })).status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("runs one UPDATE with the forward-only allowed-from list and returns the rows changed", async () => {
    queryMock.mockImplementation(answerBySql([[/UPDATE bi_contacts/, { rows: [], rowCount: 2 }]]));
    const r = await advance({ match: { id: ID, phone: "+1 (416) 555-1234", email: " Jane@Example.COM " }, to: "contacted" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, updated: 2 });
    const calls = callsMatching(queryMock, /UPDATE bi_contacts/);
    expect(calls).toHaveLength(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = calls[0] as [string, unknown[]];
    expect(sql).toContain("outreach_updated_at = now()");
    expect(sql).toMatch(/outreach_status IS NULL OR outreach_status = ANY\(\$2::text\[\]\)/);
    expect(sql).toMatch(/ OR /);
    expect(params).toEqual(["contacted", ["new", "cold", "attempting", "voicemail"], ID, "4165551234", "jane@example.com"]);
  });

  it("uses the right allowed-from list for engaged and demo_booked", async () => {
    queryMock.mockImplementation(answerBySql([[/UPDATE bi_contacts/, { rows: [], rowCount: 0 }]]));
    const e = await advance({ match: { email: "a@b.co" }, to: "engaged" });
    expect(e.body).toEqual({ ok: true, updated: 0 });
    const d = await advance({ match: { phone: "4165551234" }, to: "demo_booked" });
    expect(d.status).toBe(200);
    const calls = callsMatching(queryMock, /UPDATE bi_contacts/);
    expect((calls[0]![1] as unknown[])[1]).toEqual(["new", "contacted"]);
    expect((calls[1]![1] as unknown[])[1]).toEqual(["new", "contacted", "engaged"]);
    expect(sqlText(calls[1]![0])).toContain("right(regexp_replace(phone_e164");
  });

  it("hides database error text", async () => {
    queryMock.mockImplementation(answerBySql([[/UPDATE bi_contacts/, rejects(new Error(SECRET_TEXT))]]));
    const r = await advance({ match: { id: ID }, to: "engaged" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret_internal_table");
  });
});

describe("[31] GET /internal/outreach/contacts/:id", () => {
  const get = (id: string) => call("get", `/api/v1/bi/internal/outreach/contacts/${id}`, bfServiceToken());
  it("400 on a non-uuid id", async () => {
    expect((await get("abc")).status).toBe(400);
  });
  it("404 when missing", async () => {
    expect((await get(ID)).status).toBe(404);
  });
  it("returns exactly the four fields", async () => {
    queryMock.mockImplementation(answerBySql([[/FROM bi_contacts WHERE id = \$1/, {
      rows: [{ full_name: "Jane", email: "j@x.co", phone_e164: "+14165551234", company_id: ID2 }],
    }]]));
    const r = await get(ID);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ full_name: "Jane", email: "j@x.co", phone_e164: "+14165551234", company_id: ID2 });
  });
});

// ---------------------------------------------------------------- [32] notes

describe("[32] /api/v1/bi/applications/:id/notes", () => {
  const path = `/api/v1/bi/applications/${ID}/notes`;
  const note = { id: ID2, body: "hello", author_name: "Ann Staff", created_at: "2026-10-01T00:00:00.000Z" };

  it("401 without a token, 403 for applicant and service tokens", async () => {
    expect((await call("get", path)).status).toBe(401);
    expect((await call("get", path, applicantToken())).status).toBe(403);
    expect((await call("get", path, bfServiceToken())).status).toBe(403);
    expect((await call("post", path, bfCarrierToken(), { body: "x" })).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("GET 400 on a non-uuid application id and 404 for an unknown application", async () => {
    expect((await call("get", "/api/v1/bi/applications/abc/notes", staffToken())).status).toBe(400);
    expect((await call("get", path, staffToken())).status).toBe(404);
  });

  it("GET returns notes newest first from bi_application_notes", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_applications", { rows: [{ "?column?": 1 }] }],
      ["FROM bi_application_notes", { rows: [note] }],
    ]));
    const r = await call("get", path, staffToken());
    expect(r.status).toBe(200);
    expect(r.body.notes).toEqual([note]);
    const [sql, params] = callsMatching(queryMock, "FROM bi_application_notes")[0] as [string, unknown[]];
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual([ID]);
  });

  it("POST validates the body (1-8000 chars after trim)", async () => {
    expect((await call("post", path, staffToken(), {})).status).toBe(400);
    expect((await call("post", path, staffToken(), { body: "   " })).status).toBe(400);
    expect((await call("post", path, staffToken(), { body: 42 })).status).toBe(400);
    expect((await call("post", path, staffToken(), { body: "x".repeat(8001) })).status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("POST 404 when the application does not exist", async () => {
    queryMock.mockImplementation(answerBySql([["INSERT INTO bi_application_notes", { rows: [], rowCount: 0 }]]));
    expect((await call("post", path, staffToken(), { body: "hi" })).status).toBe(404);
  });

  it("POST 201 returns the note itself; author from the token, name from bi_staff_profile or claims", async () => {
    queryMock.mockImplementation(answerBySql([["INSERT INTO bi_application_notes", { rows: [note], rowCount: 1 }]]));
    const long = "y".repeat(8000);
    const r = await call("post", path, staffToken(), { body: `  ${long}  ` });
    expect(r.status).toBe(201);
    expect(r.body).toEqual(note);
    const [sql, params] = callsMatching(queryMock, "INSERT INTO bi_application_notes")[0] as [string, unknown[]];
    expect(sql).toContain("FROM bi_staff_profile");
    expect(sql).toContain("FROM bi_applications a");
    expect(params).toEqual([ID, "staff-1", "ann@example.com", long]);
  });

  it("hides database error text", async () => {
    queryMock.mockImplementation(answerBySql([["INSERT INTO bi_application_notes", rejects(new Error(SECRET_TEXT))]]));
    const r = await call("post", path, staffToken(), { body: "hi" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret_internal_table");
  });
});

// ---------------------------------------------------------------- [33] company activity

describe("[33] /api/v1/bi/crm/companies/:id/activity", () => {
  const path = `/api/v1/bi/crm/companies/${ID}/activity`;
  const row = { id: ID2, company_id: ID, actor_id: "staff-1", actor_name: null, event_type: "call", outcome: "spoke", body: "Talked", meta: { a: 1 }, created_at: "t", occurred_at: "t" };

  it("401 without a token, 403 for service tokens", async () => {
    expect((await call("get", path)).status).toBe(401);
    expect((await call("get", path, bfServiceToken())).status).toBe(403);
    expect((await call("post", path, bfCarrierToken(), { event_type: "call" })).status).toBe(403);
  });

  it("GET 404 for an unknown company, 400 for a non-uuid id", async () => {
    expect((await call("get", path, staffToken())).status).toBe(404);
    expect((await call("get", "/api/v1/bi/crm/companies/xyz/activity", staffToken())).status).toBe(400);
  });

  it("GET lists newest first", async () => {
    queryMock.mockImplementation(answerBySql([
      [/FROM bi_companies WHERE id/, { rows: [{ "?column?": 1 }] }],
      ["FROM bi_company_activity", { rows: [row] }],
    ]));
    const r = await call("get", path, staffToken());
    expect(r.status).toBe(200);
    expect(r.body.events).toEqual([row]);
    expect(sqlText(callsMatching(queryMock, "FROM bi_company_activity")[0]![0])).toMatch(/ORDER BY occurred_at DESC/);
  });

  it("POST validates event_type with the same rules as contact activity", async () => {
    const bad = await call("post", path, staffToken(), { event_type: "telepathy" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_event_type");
    const contactBad = await call("post", `/api/v1/bi/crm/outreach/contacts/${ID}/activity`, staffToken(), { event_type: "telepathy" });
    expect(contactBad.status).toBe(400);
    expect(contactBad.body.error).toBe("invalid_event_type");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("POST 404 for an unknown company", async () => {
    expect((await call("post", path, staffToken(), { event_type: "note", body: "x" })).status).toBe(404);
  });

  it("POST 201 inserts into bi_company_activity with trimmed body and JSON meta", async () => {
    queryMock.mockImplementation(answerBySql([["INSERT INTO bi_company_activity", { rows: [row], rowCount: 1 }]]));
    const r = await call("post", path, staffToken(), { event_type: "call", outcome: " spoke ", body: "  Talked  ", meta: { a: 1 } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, activity_id: ID2 });
    const params = callsMatching(queryMock, "INSERT INTO bi_company_activity")[0]![1] as unknown[];
    expect(params).toEqual([ID, "staff-1", null, "call", "spoke", "Talked", JSON.stringify({ a: 1 })]);
  });
});

// ---------------------------------------------------------------- [34] contacts

describe("[34] contact duplicates / merge / documents auth", () => {
  it("401 without a token and 403 for service tokens on every route", async () => {
    expect((await call("get", `/api/v1/bi/crm/contacts/${ID}/duplicates`)).status).toBe(401);
    expect((await call("get", `/api/v1/bi/crm/contacts/${ID}/duplicates`, bfServiceToken())).status).toBe(403);
    expect((await call("post", `/api/v1/bi/crm/contacts/${ID}/merge`, bfCarrierToken(), { duplicate_id: ID2 })).status).toBe(403);
    expect((await call("get", `/api/v1/bi/crm/contacts/${ID}/documents`, bfServiceToken())).status).toBe(403);
    expect((await call("get", `/api/v1/bi/crm/contacts/${ID}/documents`, applicantToken())).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("[34] GET /crm/contacts/:id/duplicates", () => {
  const path = `/api/v1/bi/crm/contacts/${ID}/duplicates`;
  it("400 / 404", async () => {
    expect((await call("get", "/api/v1/bi/crm/contacts/zz/duplicates", staffToken())).status).toBe(400);
    expect((await call("get", path, staffToken())).status).toBe(404);
  });
  it("empty phone and email never match", async () => {
    queryMock.mockImplementation(answerBySql([[/AS p10/, { rows: [{ p10: "", em: "" }] }]]));
    const r = await call("get", path, staffToken());
    expect(r.body).toEqual({ ok: true, duplicates: [] });
    expect(callsMatching(queryMock, /c\.id <> \$1/)).toHaveLength(0);
  });
  it("matches on the last 10 phone digits or lower(email) and says which", async () => {
    queryMock.mockImplementation(answerBySql([
      [/AS p10/, { rows: [{ p10: "4165551234", em: "jane@x.co" }] }],
      [/c\.id <> \$1/, { rows: [{ id: ID2, full_name: "Jane D", phone_match: true, email_match: false }] }],
    ]));
    const r = await call("get", path, staffToken());
    expect(r.status).toBe(200);
    expect(r.body.duplicates).toEqual([{ id: ID2, full_name: "Jane D", matched_on: ["phone"] }]);
    expect(callsMatching(queryMock, /c\.id <> \$1/)[0]![1]).toEqual([ID, "4165551234", "jane@x.co"]);
  });
  it("a phone shorter than 10 digits is not a match key", async () => {
    queryMock.mockImplementation(answerBySql([
      [/AS p10/, { rows: [{ p10: "5551234", em: "jane@x.co" }] }],
      [/c\.id <> \$1/, { rows: [] }],
    ]));
    await call("get", path, staffToken());
    expect(callsMatching(queryMock, /c\.id <> \$1/)[0]![1]).toEqual([ID, null, "jane@x.co"]);
  });
});

describe("[34] POST /crm/contacts/:id/merge", () => {
  const path = `/api/v1/bi/crm/contacts/${ID}/merge`;
  const keeper = { id: ID, full_name: "Jane", email: null, tags: ["lender"] };
  const dup = { id: ID2, full_name: "Jane D", email: "jane@x.co", tags: ["broker"] };

  it("400 for the same id or a non-uuid, before touching the database", async () => {
    expect((await call("post", path, staffToken(), { duplicate_id: ID })).status).toBe(400);
    expect((await call("post", path, staffToken(), { duplicate_id: "nope" })).status).toBe(400);
    expect((await call("post", path, staffToken(), {})).status).toBe(400);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("404 and ROLLBACK when either contact is missing", async () => {
    clientQueryMock.mockImplementation(answerBySql([[/FROM bi_contacts WHERE id = ANY/, { rows: [keeper] }]]));
    const r = await call("post", path, staffToken(), { duplicate_id: ID2 });
    expect(r.status).toBe(404);
    expect(callsMatching(clientQueryMock, /^ROLLBACK$/)).toHaveLength(1);
    expect(callsMatching(clientQueryMock, /^COMMIT$/)).toHaveLength(0);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("moves every referencing row, fills the keeper, deletes the duplicate, in one transaction", async () => {
    clientQueryMock.mockImplementation(answerBySql([
      [/FROM bi_contacts WHERE id = ANY/, { rows: [keeper, dup] }],
      [/^UPDATE /, { rows: [], rowCount: 1 }],
    ]));
    const r = await call("post", path, staffToken(), { duplicate_id: ID2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id: ID, merged_id: ID2 });
    const texts = clientQueryMock.mock.calls.map((c) => sqlText(c[0]));
    expect(texts[0]).toBe("BEGIN");
    expect(texts[texts.length - 1]).toBe("COMMIT");
    for (const ref of [
      "UPDATE bi_contact_activity SET contact_id",
      "UPDATE bi_crm_engagement_events SET contact_id",
      "UPDATE bi_marketing_replies SET contact_id",
      "UPDATE bi_suppressions SET contact_id",
      "UPDATE bi_activity SET contact_id",
      "UPDATE bi_applications SET primary_contact_id",
      "UPDATE bi_marketing_send_events SET contact_id",
      "UPDATE bi_email_link_clicks SET contact_id",
      "UPDATE bi_apollo_enrichment AS x",
      "UPDATE bi_apollo_enrollment AS x",
      "UPDATE bi_marketing_send_recipients AS x",
      "UPDATE bi_sequence_enrollments AS x",
    ]) {
      expect(texts.some((t) => t.includes(ref)), ref).toBe(true);
    }
    const delDup = texts.findIndex((t) => t.startsWith("DELETE FROM bi_contacts"));
    const fill = texts.findIndex((t) => t.includes("UPDATE bi_contacts AS k"));
    expect(delDup).toBeGreaterThan(0);
    expect(fill).toBeGreaterThan(delDup);
    expect(clientQueryMock.mock.calls[delDup]![1]).toEqual([ID2]);
    const fillParams = clientQueryMock.mock.calls[fill]![1] as unknown[];
    expect(fillParams[0]).toBe(ID);
    expect(JSON.parse(String(fillParams[1]))).toMatchObject({ email: "jane@x.co", tags: ["broker"] });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back, releases and hides error text when a step fails", async () => {
    clientQueryMock.mockImplementation(answerBySql([
      [/FROM bi_contacts WHERE id = ANY/, { rows: [keeper, dup] }],
      [/UPDATE bi_marketing_replies/, rejects(new Error(SECRET_TEXT))],
    ]));
    const r = await call("post", path, staffToken(), { duplicate_id: ID2 });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret_internal_table");
    expect(callsMatching(clientQueryMock, /^ROLLBACK$/)).toHaveLength(1);
    expect(callsMatching(clientQueryMock, /^COMMIT$/)).toHaveLength(0);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});

describe("[34] GET /crm/contacts/:id/documents", () => {
  const path = `/api/v1/bi/crm/contacts/${ID}/documents`;
  it("400 / 404", async () => {
    expect((await call("get", "/api/v1/bi/crm/contacts/q/documents", staffToken())).status).toBe(400);
    expect((await call("get", path, staffToken())).status).toBe(404);
  });
  it("lists unpurged documents of linked applications newest first", async () => {
    const doc = { id: ID2, application_id: ID, doc_type: "bank_statement", original_filename: "a.pdf", mime_type: "application/pdf", bytes: "10", review_status: "pending", created_at: "t" };
    queryMock.mockImplementation(answerBySql([
      [/FROM bi_contacts WHERE id/, { rows: [{ "?column?": 1 }] }],
      ["FROM bi_documents", { rows: [doc] }],
    ]));
    const r = await call("get", path, staffToken());
    expect(r.status).toBe(200);
    expect(r.body.documents).toEqual([doc]);
    const sql = sqlText(callsMatching(queryMock, "FROM bi_documents")[0]![0]);
    expect(sql).toContain("d.purged_at IS NULL");
    expect(sql).toContain("primary_contact_id = $1");
    expect(sql).toContain("FROM bi_activity");
    expect(sql).toMatch(/ORDER BY d\.created_at DESC/);
  });
});

// ---------------------------------------------------------------- [10] no provider text

describe("[10] SMS failures never store provider text in activity meta", () => {
  it("POST /crm/contacts/:id/sms logs meta.error as a code", async () => {
    vi.resetModules();
    vi.doMock("../../services/smsService", () => ({
      sendOutreachSms: async () => { throw new Error("Twilio says: secret provider body"); },
    }));
    queryMock.mockImplementation(answerBySql([
      [/SELECT phone_e164 FROM bi_contacts/, { rows: [{ phone_e164: "+14165551234" }] }],
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],
    ]));
    const { default: crm } = await import("../biCrmRoutes");
    const { requireAuth: auth } = await import("../../platform/auth");
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi", auth, crm);
    const r = await request(app).post(`/api/v1/bi/crm/contacts/${ID}/sms`).set("Authorization", `Bearer ${staffToken()}`).send({ body: "hi" });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("secret provider body");
    const params = callsMatching(queryMock, "INSERT INTO bi_contact_activity")[0]![1] as unknown[];
    expect(String(params[4])).not.toContain("secret provider body");
    expect(JSON.parse(String(params[4])).error).toBe("sms_failed");
    vi.doUnmock("../../services/smsService");
  });

  it("activity reads replace a stored provider error with a code", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_contact_activity", { rows: [{ id: "a1", event_type: "sms", meta: { sid: null, error: "Twilio says: secret provider body" } }] }],
    ]));
    const r = await call("get", `/api/v1/bi/crm/contacts/${ID}/timeline`, staffToken());
    expect(r.status).toBe(200);
    expect(r.body.events[0].meta.error).toBe("sms_failed");
  });
});
