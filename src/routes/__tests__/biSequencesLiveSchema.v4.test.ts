// BI_SERVER_SEQUENCES_LIVE_SCHEMA_v4
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("../../integrations/microsoftGraphSubscriptions", () => ({ handleGraphReplyWebhook: vi.fn() }));

import biSequencesRoutes from "../biSequencesRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/marketing", biSequencesRoutes);
  return app;
}

const LIVE_STEP_COLUMNS = new Set([
  "id", "sequence_id", "position", "type", "delay_seconds", "subject", "body",
  "variant", "conditions", "created_at", "assignee_user_id",
]);
const GONE = ["step_number", "delay_days", "body_template", "send_as_user_id", "owner_user_id", "is_active"];

describe("BI_SERVER_SEQUENCES_LIVE_SCHEMA_v4", () => {
  beforeEach(() => queryMock.mockReset());

  it("names no column the live tables lack", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/biSequencesRoutes.ts"), "utf8");
    const sql = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const column of GONE) {
      const inSql = new RegExp(`(SET|SELECT|INSERT INTO|ORDER BY)[^\`]*\\b${column}\\b`, "s");
      expect(sql).not.toMatch(inSql);
    }
  });

  it("orders steps by position, not the column that made this 500", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).get("/api/v1/bi/marketing/sequences/s1/steps").expect(200);
    const sql = String(queryMock.mock.calls[0]![0]);
    expect(sql).toContain("ORDER BY position ASC");
    expect(sql).not.toMatch(/step_number/);
    const selected = sql.slice(sql.indexOf("SELECT") + 6, sql.indexOf("FROM")).split(",").map((s) => s.trim());
    for (const column of selected) expect(LIVE_STEP_COLUMNS.has(column)).toBe(true);
  });

  it("converts a legacy delay_days into delay_seconds", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "st1" }] });
    await request(makeApp()).post("/api/v1/bi/marketing/sequences/s1/steps")
      .send({ step_number: 2, delay_days: 3, subject: "Hi", body_template: "Hello" }).expect(201);
    const params = queryMock.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe(2);
    expect(params[3]).toBe(3 * 86400);
    expect(params[5]).toBe("Hello");
  });

  it("prefers delay_seconds when both are supplied", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "st1" }] });
    await request(makeApp()).post("/api/v1/bi/marketing/sequences/s1/steps")
      .send({ delay_seconds: 90, delay_days: 3 }).expect(201);
    expect((queryMock.mock.calls[0]![1] as unknown[])[3]).toBe(90);
  });

  it("appends to the end when no position is given", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "st1" }] });
    await request(makeApp()).post("/api/v1/bi/marketing/sequences/s1/steps")
      .send({ subject: "Follow up" }).expect(201);
    expect(String(queryMock.mock.calls[0]![0])).toContain("MAX(position), 0) + 1");
  });

  it("404s rather than 200-with-nothing on an unknown step", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await request(makeApp()).patch("/api/v1/bi/marketing/sequences/s1/steps/nope")
      .send({ subject: "x" }).expect(404);
  });

  it("no longer registers the six paths biMarketingRoutes already serves", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/biSequencesRoutes.ts"), "utf8");
    for (const dead of [
      `router.get("/sequences"`, `router.post("/sequences"`,
      `router.get("/sequences/:id"`, `router.patch("/sequences/:id"`,
      `router.delete("/sequences/:id"`, `router.post("/sequences/:id/enroll"`,
    ]) expect(src).not.toContain(dead);
    expect(src).toContain(`router.get("/sequences/:id/steps"`);
    expect(src).toContain(`router.delete("/sequences/:id/steps/:stepId"`);
  });

  it("keeps writing bi_contact_activity out of this file entirely", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/biSequencesRoutes.ts"), "utf8");
    expect(src).not.toContain("bi_contact_activity");
  });
});
