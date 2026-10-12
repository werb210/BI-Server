// BF_PORTAL_TEMPLATE_SAVE_BY_NAME_v8
// v789 [5]/[37]: was a grep of biMarketingRoutes.ts; now POSTs to the real
// router and asserts on the response and the SQL it sends.
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biMarketingRoutes from "../biMarketingRoutes";

const row = { id: "t-1", name: "August", subject: "new", body_text: "b", body_html: null, category: "email", fields: null, is_active: true };

function save(existing: boolean) {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    [/SELECT id FROM bi_email_templates\s+WHERE lower\(name\)/, existing ? { rows: [{ id: "t-1" }], rowCount: 1 } : { rows: [], rowCount: 0 }],
    ["UPDATE bi_email_templates", { rows: [row], rowCount: 1 }],
    ["INSERT INTO bi_email_templates", { rows: [{ ...row, id: "t-2" }], rowCount: 1 }],
  ]));
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/marketing", biMarketingRoutes);
  return request(app).post("/api/v1/bi/marketing/templates").send({ name: "  August ", subject: "new", body: "b", category: "email" });
}

describe("BI email template save by name", () => {
  it("looks for an existing template with the same name and category", async () => {
    await save(false);
    const [lookup] = callsMatching(queryMock, /SELECT id FROM bi_email_templates/);
    const text = sqlText(lookup![0]);
    expect(text).toContain("lower(name) = lower($1)");
    expect(text).toContain("COALESCE(category, '') = COALESCE($2, '')");
    expect(lookup![1]).toEqual(["August", "email"]);
  });

  it("updates the existing template instead of creating a duplicate", async () => {
    const r = await save(true);
    expect(r.status).toBe(200);
    expect(callsMatching(queryMock, "INSERT INTO bi_email_templates")).toHaveLength(0);
    const [update] = callsMatching(queryMock, "UPDATE bi_email_templates");
    expect(sqlText(update![0])).toContain("WHERE id = $1");
    expect((update![1] as unknown[])[0]).toBe("t-1");
    expect((update![1] as unknown[])[1]).toBe("new");
  });

  it("tells the portal whether the save replaced an existing template", async () => {
    const replaced = await save(true);
    expect(replaced.body).toMatchObject({ id: "t-1", replaced: true });
    const created = await save(false);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "t-2", replaced: false });
  });
});
