// BI_SERVER_SEQUENCE_TEMPLATES_v284
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const calls: Array<{ sql: string; params: unknown[] }> = [];
const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("INSERT INTO bi_sequences")) return { rows: [{ id: "seq-1" }] };
    if (sql.includes("FROM bi_email_templates")) {
      return params[0] === "tpl-1" ? { rows: [{ subject: "Your PGI quote", body_html: "<p>Hi</p>", body_text: "Hi" }] } : { rows: [] };
    }
    return { rows: [] };
  }),
  release: vi.fn(),
};
vi.mock("../db", () => ({ pool: { connect: async () => client, query: vi.fn() } }));
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { default: router } = await import("../routes/biMarketingRoutes");
const app = express();
app.use(express.json());
app.use("/m", router);

beforeEach(() => { calls.length = 0; });

describe("saving a sequence from the canvas", () => {
  it("copies the chosen template's subject and body onto the email step", async () => {
    const res = await request(app).post("/m/sequences").send({
      name: "Follow-up",
      steps: [
        { type: "email", position: 0, delay_seconds: 0, template_id: "tpl-1", conditions: { rule: "always" } },
        { type: "task", position: 1, delay_seconds: 86400, subject: "Call them", assignee_user_id: "11111111-1111-1111-1111-111111111111" },
      ],
    });
    expect(res.status).toBe(201);
    const inserts = calls.filter((c) => c.sql.includes("INSERT INTO bi_sequence_steps"));
    expect(inserts[0].params[4]).toBe("Your PGI quote");
    expect(inserts[0].params[5]).toBe("<p>Hi</p>");
    expect(JSON.parse(String(inserts[0].params[7]))).toMatchObject({ rule: "always", template_id: "tpl-1" });
    expect(inserts[1].params[4]).toBe("Call them");
  });

  it("refuses an email step with no template instead of saving a blank email", async () => {
    const res = await request(app).post("/m/sequences").send({ name: "Broken", steps: [{ type: "email", delay_seconds: 0, template_id: null }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("step 1: choose an email template");
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
  });
});
