// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import * as XLSX from "xlsx";

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

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function staffToken() {
  return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
}
function buildXlsx(rows: Array<Record<string, unknown>>): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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
    queryMock
      .mockResolvedValueOnce({ rows: [] })                       // suppression lookup
      .mockResolvedValueOnce({ rows: [] })                       // company lookup
      .mockResolvedValueOnce({ rows: [{ id: "co-1" }] })          // company insert
      .mockResolvedValueOnce({ rows: [] })                       // existing contact lookup
      .mockResolvedValueOnce({ rows: [{ id: "c-1" }] })           // contact insert
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });           // activity insert

    const xlsx = buildXlsx([
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
    const xlsx = buildXlsx([
      { full_name: "Jane Doe", email: "jane@example.com" },
      { full_name: "", email: "nobody@example.com" },
    ]);
    // Jane: suppression lookup → existing contact lookup → contact insert → activity insert.
    queryMock
      .mockResolvedValueOnce({ rows: [] })               // suppression lookup
      .mockResolvedValueOnce({ rows: [] })               // existing contact lookup
      .mockResolvedValueOnce({ rows: [{ id: "c-1" }] })  // contact insert
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // activity

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
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // suppression lookup
      .mockResolvedValueOnce({ rows: [{ id: "c-1", tags: ["warm"] }] }) // existing contact lookup
      .mockResolvedValueOnce({ rows: [{ id: "c-1" }] }) // contact update
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // activity

    const xlsx = buildXlsx([
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

    const xlsx = buildXlsx([
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
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "co-1" }] })       // company found
      .mockResolvedValueOnce({ rows: [{ id: "c-1" }] })         // contact insert
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });         // activity

    const xlsx = buildXlsx([
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

  it("clears outreach_status for remove_from_outreach", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/bulk-action")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({ ids: ["c-1", "c-2"], mode: "remove_from_outreach" });

    expect(r.status).toBe(200);
    expect(r.body.affected).toBe(2);
    expect(String(queryMock.mock.calls[0][0])).toContain("outreach_status = NULL");
  });

  it("suppresses and deletes contacts for delete_from_crm", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: null }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "c-1", email: "jane@example.com", phone_e164: "+14165551234" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // suppression insert
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // activity delete
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // contact delete
      .mockResolvedValueOnce({ rows: [], rowCount: null }); // COMMIT

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
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: null }] })
      .mockResolvedValueOnce({
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: null }],
      });

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bookings_url_missing");
  });

  it("404s when contact does not exist", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/missing/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(404);
  });

  it("400s when contact has no phone", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] })
      .mockResolvedValueOnce({
        rows: [{ phone_e164: null, full_name: "Jane", outreach_status: null }],
      });
    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("contact_has_no_phone");
  });

  it("sends SMS, logs activity, bumps status to attempting when cold", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] })
      .mockResolvedValueOnce({
        rows: [{ phone_e164: "+14165551234", full_name: "Jane Doe", outreach_status: "cold" }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // activity log
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // status bump
    sendSmsMock.mockResolvedValueOnce({ sid: "SM123" });

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
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] })
      .mockResolvedValueOnce({
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: "engaged" }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // activity log only
    sendSmsMock.mockResolvedValueOnce({ sid: "SM124" });

    const r = await request(makeApp())
      .post("/crm/outreach/contacts/c1/demo-invite")
      .set("Authorization", `Bearer ${staffToken()}`)
      .send({});

    expect(r.status).toBe(200);
    // 3 queries: bookings, contact, activity. No status bump.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("logs failed=failed and returns 502 when SMS throws", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ bookings_url: "https://outlook.office.com/bookings/x" }] })
      .mockResolvedValueOnce({
        rows: [{ phone_e164: "+14165551234", full_name: "Jane", outreach_status: "cold" }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // activity log (failed)
    sendSmsMock.mockRejectedValueOnce(new Error("twilio 21408"));

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
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({ rows: [{ id: "lender-1" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT
    sendSmsMock.mockResolvedValueOnce({ sid: "SM1" });

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
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

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
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

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
