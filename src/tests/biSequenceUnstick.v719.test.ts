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
import { answerBySql, callsMatching } from "../__tests__/helpers/answerBySql";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const worker = read("workers/marketingWorker.ts");
const marketing = read("routes/biMarketingRoutes.ts");
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
  it("Start and re-enrolling revive an enrollment stuck active with no next step", () => {
    expect(marketing).toContain("status = 'active' AND next_step_at IS NULL");
    expect(marketing).toContain("bi_sequence_enrollments.status = 'active' AND bi_sequence_enrollments.next_step_at IS NULL");
  });
  it("existing stuck enrollments are repaired once", () => {
    expect(migration).toContain("SET next_step_at = NOW()");
    expect(migration).toContain("WHERE status = 'active' AND next_step_at IS NULL");
  });
  it("the unsubscribe check reads the identifier column the suppression list is written to", () => {
    expect(worker).toContain("lower(identifier) = lower($3)");
  });
});
