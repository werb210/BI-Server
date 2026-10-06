// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { buildXlsx as buildSheet } from "../../lib/spreadsheet"; // v376

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: async () => ({
      query: (...args: unknown[]) => queryMock(...args),
      release: vi.fn(),
    }),
  },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: "test-shared-secret-min-10", DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const sendSmsMock = vi.fn();
vi.mock("../../services/smsService", () => ({
  sendOutreachSms: (...args: unknown[]) => sendSmsMock(...args),
}));

import router from "../biOutreachCrmRoutes";
import { answerBySql, rejects } from "../../__tests__/helpers/answerBySql";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function staffToken() {
  return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
}
async function buildXlsx(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return buildSheet([keys, ...rows.map((row) => keys.map((k) => row[k] ?? null))]);
}

describe("BI_SERVER_BLOCK_v252 — POST /crm/outreach/import", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("400s with file_required when no file is attached", async () => {
    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("file_required");
  });

  it("imports a single contact with company lookup-or-create", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_suppressions", { rows: [] }],  // suppression lookup
      ["FROM bi_companies", { rows: [] }],  // company lookup
      ["INSERT INTO bi_companies", { rows: [{ id: "co-1" }] }],  // company insert
      ["FROM bi_contacts", { rows: [] }],  // existing contact lookup
      ["INSERT INTO bi_contacts", { rows: [{ id: "c-1" }] }],  // contact insert
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity insert
    ], queryMock.getMockImplementation()));

    const xlsx = await buildXlsx([
      {
        full_name: "Jane Doe",
        company_name: "Acme Inc",
        email: "jane@example.com",
        phone: "4165551234",
        title: "CFO",
        tags: "warm, q3",
        notes: "Met at conference",
      },
    ]);

    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .attach("file", xlsx, "list.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1);
    expect(r.body.updated).toBe(0);
    expect(r.body.suppressed).toBe(0);
    expect(r.body.skipped).toBe(0);

    // Verify phone normalization and forced lender tagging on the contact insert.
    const contactInsertCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO bi_contacts"),
    );
    expect(contactInsertCall).toBeDefined();
    expect(contactInsertCall![1]).toContain("+14165551234");
    expect(contactInsertCall![1][4]).toContain("lender");
  });

  it("skips rows missing full_name", async () => {
    const xlsx = await buildXlsx([
      { full_name: "Jane Doe", email: "jane@example.com" },
      { full_name: "", email: "nobody@example.com" },
    ]);
    // Jane: suppression lookup → existing contact lookup → contact insert → activity insert.
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_suppressions", { rows: [] }],  // suppression lookup
      ["FROM bi_contacts", { rows: [] }],  // existing contact lookup
      ["INSERT INTO bi_contacts", { rows: [{ id: "c-1" }] }],  // contact insert
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity
    ], queryMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .attach("file", xlsx, "list.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1);
    expect(r.body.skipped).toBe(1);
    const skipped = r.body.results.find((x: any) => !x.ok);
    expect(skipped.error).toBe("missing_full_name");
  });

  it("updates existing contacts by email instead of duplicating", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_suppressions", { rows: [] }],  // suppression lookup
      ["FROM bi_contacts", { rows: [{ id: "c-1", tags: ["warm"] }] }],  // existing contact lookup
      ["UPDATE bi_contacts", { rows: [{ id: "c-1" }] }],  // contact update
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity
    ], queryMock.getMockImplementation()));

    const xlsx = await buildXlsx([
      { full_name: "Jane Updated", email: "jane@example.com", tags: "q3" },
    ]);

    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .attach("file", xlsx, "list.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(0);
    expect(r.body.updated).toBe(1);
    const updateCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE bi_contacts SET"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1][6]).toContain("warm");
    expect(updateCall![1][6]).toContain("q3");
    expect(updateCall![1][6]).toContain("lender");
  });

  it("skips suppressed email rows", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // suppression lookup

    const xlsx = await buildXlsx([
      { full_name: "Jane Doe", email: "jane@example.com" },
    ]);

    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .attach("file", xlsx, "list.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(0);
    expect(r.body.updated).toBe(0);
    expect(r.body.suppressed).toBe(1);
    expect(r.body.results[0].error).toBe("suppressed");
  });

  it("recognizes header aliases (Name, Company, Phone, Role)", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_companies", { rows: [{ id: "co-1" }] }],  // company found
      ["INSERT INTO bi_contacts", { rows: [{ id: "c-1" }] }],  // contact insert
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity
    ], queryMock.getMockImplementation()));

    const xlsx = await buildXlsx([
      { Name: "Jane Doe", Company: "Acme", Phone: "+14165551234", Role: "CFO" },
    ]);

    const r = await request(makeApp())
      .post("/crm/outreach/import")
      .set("Authorization", `Bearer ${staffToken()}`)
      .attach("file", xlsx, "list.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1);
  });
});

describe("BI_SERVER_BLOCK_v799 — POST /crm/outreach/contacts/bulk-action", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("excludes contacts for remove_from_outreach (v853)", async () => { // BI_SERVER_BLOCK_v585
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/bulk-action")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ ids: ["c-1", "c-2"], mode: "remove_from_outreach" });

    expect(r.status).toBe(200);
    expect(r.body.affected).toBe(2);
    expect(String(queryMock.mock.calls[0][0])).toContain("outreach_excluded = TRUE");
  });

  it("suppresses and deletes contacts for delete_from_crm", async () => {
    queryMock.mockImplementation(answerBySql([
      ["BEGIN", { rows: [], rowCount: null }],  // BEGIN
      ["SELECT id,", { rows: [{ id: "c-1", email: "jane@example.com", phone_e164: "+14165551234" }] }],
      ["INSERT INTO bi_suppressions", { rows: [], rowCount: 1 }],  // suppression insert
      ["DELETE FROM bi_contact_activity", { rows: [], rowCount: 1 }],  // activity delete
      ["DELETE FROM bi_contacts", { rows: [], rowCount: 1 }],  // contact delete
      ["COMMIT", { rows: [], rowCount: null }],  // COMMIT
    ], queryMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/bulk-action")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ ids: ["c-1"], mode: "delete_from_crm" });

    expect(r.status).toBe(200);
    expect(r.body.affected).toBe(1);
    expect(r.body.suppressed).toBe(1);
    expect(queryMock.mock.calls.some((call) => String(call[0]).includes("INSERT INTO bi_suppressions"))).toBe(true);
    expect(queryMock.mock.calls.some((call) => String(call[0]).includes("DELETE FROM bi_contacts"))).toBe(true);
  });
});

describe("BI_SERVER_BLOCK_v252 — POST /crm/outreach/contacts/:id/demo-invite", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("400s when staff has no bookings_url", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: null }] }],
      ["FROM bi_contacts", {
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: null }],
      }],
    ], queryMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bookings_url_missing");
  });

  it("404s when contact does not exist", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] }],
      ["FROM bi_contacts", { rows: [] }],
    ], queryMock.getMockImplementation()));
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/missing/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(404);
  });

  it("400s when contact has no phone", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] }],
      ["FROM bi_contacts", {
        rows: [{ phone_e164: null, full_name: "Jane", outreach_status: null }],
      }],
    ], queryMock.getMockImplementation()));
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("contact_has_no_phone");
  });

  it("sends SMS, logs activity, bumps status to attempting when cold", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] }],
      ["FROM bi_contacts", {
        rows: [{ phone_e164: "+14165551234", full_name: "Jane Doe", outreach_status: "cold" }],
      }],
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity log
      ["UPDATE bi_contacts", { rows: [], rowCount: 1 }],  // status bump
    ], queryMock.getMockImplementation()));
    sendSmsMock.mockImplementation(answerBySql([
      ["+14165551234", { sid: "SM123" }],
    ], sendSmsMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(200);
    expect(r.body.sid).toBe("SM123");
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const [to, body] = sendSmsMock.mock.calls[0];
    expect(to).toBe("+14165551234");
    expect(body).toContain("Jane");
    expect(body).toContain("https://outlook.office.com/bookings/x");
  });

  it("does NOT bump status when contact is already engaged", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] }],
      ["FROM bi_contacts", {
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: "engaged" }],
      }],
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity log only
    ], queryMock.getMockImplementation()));
    sendSmsMock.mockImplementation(answerBySql([
      ["+14165551234", { sid: "SM124" }],
    ], sendSmsMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(200);
    // 3 queries: bookings, contact, activity. No status bump.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("logs failed=failed and returns 502 when SMS throws", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_staff_profile", { rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] }],
      ["FROM bi_contacts", {
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: "cold" }],
      }],
      ["INSERT INTO bi_contact_activity", { rows: [], rowCount: 1 }],  // activity log (failed)
    ], queryMock.getMockImplementation()));
    sendSmsMock.mockImplementation(answerBySql([
      ["+14165551234", rejects(new Error("twilio 21408"))],
    ], sendSmsMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(502);
    expect(r.body.error).toBe("sms_failed");
    // Activity log fired with outcome=failed; no status bump on failure.
    const activityCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("bi_contact_activity"),
    );
    expect(activityCall).toBeDefined();
    expect(activityCall![1]).toContain("failed");
  });
});

describe("BI_SERVER_BLOCK_v410 — POST /crm/outreach/contacts/:id/start-onboarding", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendSmsMock.mockReset();
  });

  it("creates a lender, links it to the contact, advances stage, and sends SMS", async () => {
    queryMock.mockImplementation(answerBySql([
      ["BEGIN", { rows: [], rowCount: 0 }],  // BEGIN
      ["FROM bi_contacts", {
        rows: [
          {
            id: "c1",
            full_name: "Jane Doe",
            email: "JANE@EXAMPLE.COM",
            phone_e164: "+14165551234",
            company_name: "Acme Inc",
            promoted_lender_id: null,
          },
        ],
      }],
      ["INSERT INTO bi_lenders", { rows: [{ id: "lender-1" }] }],
      ["UPDATE bi_contacts", { rows: [], rowCount: 1 }],
      ["COMMIT", { rows: [], rowCount: 0 }],  // COMMIT
    ], queryMock.getMockImplementation()));
    sendSmsMock.mockImplementation(answerBySql([
      ["+14165551234", { sid: "SM1" }],
    ], sendSmsMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/start-onboarding")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, lender_id: "lender-1" });

    const lenderInsertCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO bi_lenders"),
    );
    expect(lenderInsertCall).toBeDefined();
    expect(String(lenderInsertCall![0])).toMatch(/website_url, address_line1, city, province, postal_code/);
    expect(lenderInsertCall![1]).toEqual([
      "Acme Inc",
      "Jane Doe",
      "jane@example.com",
      "+14165551234",
    ]);

    const contactUpdateCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE bi_contacts"),
    );
    expect(contactUpdateCall).toBeDefined();
    expect(String(contactUpdateCall![0])).toContain("promoted_lender_id");
    expect(String(contactUpdateCall![0])).toContain("outreach_status = 'onboarding'");
    expect(contactUpdateCall![1]).toEqual(["c1", "lender-1"]);
    expect(sendSmsMock).toHaveBeenCalledWith(
      "+14165551234",
      expect.stringContaining("you have been added as a lender"),
    );
  });

  it("409s without inserting when the contact is already linked to a lender", async () => {
    queryMock.mockImplementation(answerBySql([
      ["BEGIN", { rows: [], rowCount: 0 }],  // BEGIN
      ["FROM bi_contacts", {
        rows: [
          {
            id: "c1",
            full_name: "Jane Doe",
            email: "jane@example.com",
            phone_e164: "+14165551234",
            company_name: "Acme Inc",
            promoted_lender_id: "existing-lender",
          },
        ],
      }],
      ["ROLLBACK", { rows: [], rowCount: 0 }],  // ROLLBACK
    ], queryMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/start-onboarding")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ALREADY_ONBOARDED");
    expect(r.body.lender_id).toBe("existing-lender");
    expect(
      queryMock.mock.calls.some((call) => String(call[0]).includes("INSERT INTO bi_lenders")),
    ).toBe(false);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("400s without inserting when required contact fields are missing", async () => {
    queryMock.mockImplementation(answerBySql([
      ["BEGIN", { rows: [], rowCount: 0 }],  // BEGIN
      ["FROM bi_contacts", {
        rows: [
          {
            id: "c1",
            full_name: "Jane Doe",
            email: null,
            phone_e164: "+14165551234",
            company_name: "Acme Inc",
            promoted_lender_id: null,
          },
        ],
      }],
      ["ROLLBACK", { rows: [], rowCount: 0 }],  // ROLLBACK
    ], queryMock.getMockImplementation()));

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/start-onboarding")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("MISSING_CONTACT_FIELDS");
    expect(
      queryMock.mock.calls.some((call) => String(call[0]).includes("INSERT INTO bi_lenders")),
    ).toBe(false);
  });
});
