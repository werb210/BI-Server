// BI_SERVER_BLOCK_v719
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { vi } from "vitest";

const outreachQueryMock = vi.fn();
vi.mock("../db", () => ({ pool: { query: (...args: unknown[]) => outreachQueryMock(...args) } }));
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import outreachRouter from "../routes/biOutreachCrmRoutes";
import marketingRouter from "../routes/biMarketingRoutes";
import { answerBySql, callsMatching, sqlText } from "../__tests__/helpers/answerBySql";

// v789 [5]/[37]: biMarketingRoutes.ts is exercised through requests below; the
// worker and migration files were not changed in this block and keep their
// source checks.
const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const worker = read("workers/marketingWorker.ts");
const migration = read("db/migrations/2026_10_09_v719_unstick_enrollments.sql");

describe("BI sequences can actually send", () => {
  // BI_SERVER_v789 [5]/[37] - behaviour test (was a grep of biOutreachCrmRoutes.ts).
  it("staff can record a CASL consent basis (nothing ever set it, so every enrollment was skipped)", async () => {
    outreachQueryMock.mockReset();
    outreachQueryMock.mockImplementation(answerBySql([[/UPDATE bi_contacts\s+SET marketing_consent_basis/, { rows: [{ id: "x" }], rowCount: 1 }]]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi", outreachRouter);
    const token = jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string);
    const id = "11111111-1111-4111-8111-111111111111";
    for (const basis of ["express", "implied_published", "implied_relationship"]) {
      const r = await request(app).post("/api/v1/bi/crm/outreach/contacts/consent")
        .set("Authorization", `Bearer ${token}`).send({ basis, contact_ids: [id] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, updated: 1 });
    }
    const upd = callsMatching(outreachQueryMock, /SET marketing_consent_basis/);
    expect(upd).toHaveLength(3);
    expect(String(upd[2]![0])).toContain("interval '2 years'");
    expect((upd[2]![1] as unknown[])[1]).toBe("implied_relationship");
    const bad = await request(app).post("/api/v1/bi/crm/outreach/contacts/consent")
      .set("Authorization", `Bearer ${token}`).send({ basis: "guess", contact_ids: [id] });
    expect(bad.status).toBe(400);
  });
  it("the worker parks an inactive sequence's enrollment as paused, not active-with-nothing-due", () => {
    expect(worker).toContain("status = 'paused', paused_reason = 'sequence_inactive'");
  });
  it("Start and re-enrolling revive an enrollment stuck active with no next step", async () => {
    const seq = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const contact = "11111111-1111-4111-8111-111111111111";
    outreachQueryMock.mockReset();
    outreachQueryMock.mockImplementation(answerBySql([
      ["UPDATE bi_sequences SET status = 'active'", { rows: [{ id: seq }], rowCount: 1 }],
      ["FROM bi_sequences WHERE id = $1", { rows: [{ id: seq }], rowCount: 1 }],
      ["SELECT delay_seconds FROM bi_sequence_steps", { rows: [{ delay_seconds: 0 }], rowCount: 1 }],
      ["INSERT INTO bi_sequence_enrollments", { rows: [{ fresh: false }], rowCount: 1 }],
    ]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/marketing", marketingRouter);

    expect((await request(app).post(`/api/v1/bi/marketing/sequences/${seq}/start`)).body).toEqual({ ok: true });
    const revive = callsMatching(outreachQueryMock, /UPDATE bi_sequence_enrollments SET next_step_at = NOW\(\)/);
    expect(revive).toHaveLength(1);
    expect(sqlText(revive[0]![0])).toContain("status = 'active' AND next_step_at IS NULL");
    expect(revive[0]![1]).toEqual([seq]);

    const enrolled = await request(app).post(`/api/v1/bi/marketing/sequences/${seq}/enroll`).send({ contact_ids: [contact] });
    expect(enrolled.body).toMatchObject({ inserted: 1, restarted: 1 });
    const [insert] = callsMatching(outreachQueryMock, "INSERT INTO bi_sequence_enrollments");
    expect(sqlText(insert![0])).toContain("bi_sequence_enrollments.status = 'active' AND bi_sequence_enrollments.next_step_at IS NULL");
  });
  it("existing stuck enrollments are repaired once", () => {
    expect(migration).toContain("SET next_step_at = NOW()");
    expect(migration).toContain("WHERE status = 'active' AND next_step_at IS NULL");
  });
  it("the unsubscribe check reads the identifier column the suppression list is written to", () => {
    expect(worker).toContain("lower(identifier) = lower($3)");
  });
});
