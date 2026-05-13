// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import * as XLSX from "xlsx";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const SECRET = "test-shared-secret-min-10";
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET, DATABASE_URL: "postgres://test" },
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
      .mockResolvedValueOnce({ rows: [] })                       // company lookup
      .mockResolvedValueOnce({ rows: [{ id: "co-1" }] })          // company insert
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
    expect(r.body.skipped).toBe(0);

    // Verify phone normalization on the contact insert.
    const contactInsertCall = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO bi_contacts"),
    );
    expect(contactInsertCall).toBeDefined();
    expect(contactInsertCall![1]).toContain("+14165551234");
  });

  it("skips rows missing full_name", async () => {
    const xlsx = buildXlsx([
      { full_name: "Jane Doe", email: "jane@example.com" },
      { full_name: "", email: "nobody@example.com" },
    ]);
    // Jane: company lookup → contact insert → activity insert (3 queries)
    queryMock
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

  it("recognizes header aliases (Name, Company, Phone, Role)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "co-1" }] })       // company found
      .mockResolvedValueOnce({ rows: [{ id: "c-1" }] })         // contact
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
