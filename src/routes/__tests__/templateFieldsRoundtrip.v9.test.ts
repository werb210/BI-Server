// BI_SERVER_TEMPLATE_FIELDS_ROUNDTRIP_v9
// v789 [5]/[37]: the biMarketingRoutes.ts greps are now create / list / patch
// requests to the real router; the composer `fields` must go in and come back.
// The migration check reads a .sql file and stays.
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";
import { insertColumns } from "../../__tests__/helpers/insertColumns";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biMarketingRoutes from "../biMarketingRoutes";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../db/migrations/2026_08_05_bi_email_templates_fields.sql"), "utf8");

const FIELDS = { headline: "PG cover", ctaUrl: "https://boreal.insure" };
const stored = { id: "t-1", name: "August", subject: "s", body_text: "b", body_html: null, category: "email", fields: FIELDS, is_active: true };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi/marketing", biMarketingRoutes);
  return a;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    [/SELECT id FROM bi_email_templates\s+WHERE lower\(name\)/, { rows: [], rowCount: 0 }],
    ["INSERT INTO bi_email_templates", { rows: [stored], rowCount: 1 }],
    [/FROM bi_email_templates .*ORDER BY name/, { rows: [stored], rowCount: 1 }],
    ["UPDATE bi_email_templates SET", { rows: [stored], rowCount: 1 }],
  ]));
});

describe("BI email template round-trip", () => {
  it("adds the fields column idempotently", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS fields jsonb");
  });

  it("persists and returns fields on create", async () => {
    const r = await request(app()).post("/api/v1/bi/marketing/templates")
      .send({ name: "August", subject: "s", body: "b", category: "email", fields: FIELDS });
    expect(r.status).toBe(201);
    expect(r.body.fields).toEqual(FIELDS);
    const [insert] = callsMatching(queryMock, "INSERT INTO bi_email_templates");
    const row = insertColumns(sqlText(insert![0]), insert![1] as unknown[]);
    expect(JSON.parse(String(row.fields.value))).toEqual(FIELDS);
    expect(row.name.value).toBe("August");
    expect(row.is_active.expr).toMatch(/COALESCE\(\$\d+, TRUE\)/);
    expect(sqlText(insert![0])).toMatch(/RETURNING [^;]*\bfields\b/);
  });

  it("returns fields on list", async () => {
    const r = await request(app()).get("/api/v1/bi/marketing/templates");
    expect(r.status).toBe(200);
    expect(r.body.items[0].fields).toEqual(FIELDS);
    const [select] = callsMatching(queryMock, /ORDER BY name/);
    expect(sqlText(select![0])).toMatch(/SELECT [^]*\bfields\b[^]*FROM bi_email_templates/);
  });

  it("allows fields through patch", async () => {
    const r = await request(app()).patch("/api/v1/bi/marketing/templates/t-1").send({ fields: FIELDS, category: "email", is_active: false });
    expect(r.status).toBe(200);
    const [update] = callsMatching(queryMock, "UPDATE bi_email_templates SET");
    const text = sqlText(update![0]);
    const params = update![1] as unknown[];
    const fieldsRef = /fields = \$(\d+)/.exec(text);
    expect(fieldsRef).not.toBeNull();
    expect(JSON.parse(String(params[Number(fieldsRef![1]) - 1]))).toEqual(FIELDS);
    expect(text).toMatch(/category = \$\d+/);
    expect(text).toMatch(/is_active = \$\d+/);
    expect(params.at(-1)).toBe("t-1");
  });
});
