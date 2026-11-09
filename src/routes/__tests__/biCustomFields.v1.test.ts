// BI_SERVER_CUSTOM_FIELDS_v1 - /api/v1/bi/custom-fields, database faked by SQL content.
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching, type SqlRule } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => h.query(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { requireAuth } from "../../platform/auth";
import routes from "../biCustomFieldsRoutes";

const C1 = "11111111-1111-4111-8111-111111111111";
const F1 = "44444444-4444-4444-8444-444444444444";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/v1/bi", requireAuth, routes); return a; };
const tok = (role = "staff") => `Bearer ${jwt.sign({ staffUserId: "staff-1", role }, process.env.JWT_SECRET as string)}`;
const db = (rules: SqlRule[]) => h.query.mockImplementation(answerBySql(rules, { rows: [], rowCount: 0 }));
const DEF = { id: F1, object_type: "contact", name: "renewal_month", label: "Renewal month", field_type: "text", options: [], required: false, group_name: null, description: null, sort_order: 10, archived_at: null };

beforeEach(() => { h.query.mockReset(); db([]); });

describe("BI custom fields", () => {
  it("lists the fields of contacts and companies", async () => {
    db([[/FROM bi_custom_field_definitions WHERE object_type = \$1 ORDER/, { rows: [DEF] }]]);
    const r = await request(app()).get("/api/v1/bi/custom-fields").set("Authorization", tok());
    expect(r.status).toBe(200);
    expect(r.body.silo).toBe("BI");
    expect(r.body.objects.contact[0].name).toBe("renewal_month");
  });

  it("only Admins create fields", async () => {
    const r = await request(app()).post("/api/v1/bi/custom-fields/contact").set("Authorization", tok("staff")).send({ label: "Renewal month", field_type: "text" });
    expect(r.status).toBe(403);
    db([
      [/count\(\*\) FILTER/, { rows: [{ active: 0, total: 0 }] }],
      [/max\(sort_order\)/, { rows: [{ n: 10 }] }],
      [/INSERT INTO bi_custom_field_definitions/, { rows: [DEF] }],
    ]);
    const ok = await request(app()).post("/api/v1/bi/custom-fields/contact").set("Authorization", tok("admin")).send({ label: "Renewal month", field_type: "text" });
    expect(ok.status).toBe(201);
    expect(ok.body.field.label).toBe("Renewal month");
  });

  it("reads and writes a contact's values", async () => {
    db([
      [/SELECT custom_fields FROM bi_contacts/, { rows: [{ custom_fields: {} }] }],
      [/FROM bi_custom_field_definitions WHERE object_type = \$1 ORDER/, { rows: [DEF] }],
      [/UPDATE bi_contacts SET custom_fields/, { rows: [{ custom_fields: { renewal_month: "March" } }] }],
    ]);
    const r = await request(app()).put(`/api/v1/bi/custom-fields/contact/records/${C1}`).set("Authorization", tok()).send({ values: { renewal_month: "March" } });
    expect(r.status).toBe(200);
    expect(r.body.values).toEqual({ renewal_month: "March" });
    expect(callsMatching(h.query, /UPDATE bi_contacts SET custom_fields/)).toHaveLength(1);
  });

  it("refuses applications (BI has none) and unknown records", async () => {
    expect((await request(app()).get("/api/v1/bi/custom-fields/application").set("Authorization", tok())).status).toBe(404);
    expect((await request(app()).get(`/api/v1/bi/custom-fields/contact/records/${C1}`).set("Authorization", tok())).status).toBe(404);
  });
});
