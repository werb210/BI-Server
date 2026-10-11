// BI_ENROLL_LIVE_COLUMNS_v175
// Static source guard. The live shape of bi_sequence_enrollments comes from
// src/db/live-schema.json; these three files have each been written against a
// migration twin that never applied.
// v789 [5]/[37]: the biMarketingRoutes.ts check now reads the diagnostic SQL the
// real enroll route sends; the other checks read files this block did not change.
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biMarketingRoutes from "../biMarketingRoutes";

const live: Record<string, string[]> = JSON.parse(
  readFileSync("src/db/live-schema.json", "utf-8"),
);
const cols = live["bi_sequence_enrollments"];

describe("bi_sequence_enrollments column usage matches the live table", () => {
  it("live table has started_at and next_step_at, not enrolled_at", () => {
    expect(cols).toContain("started_at");
    expect(cols).toContain("next_step_at");
    expect(cols).not.toContain("enrolled_at");
  });

  it("the enroll diagnostic no longer reads enrolled_at", async () => {
    const seq = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    queryMock.mockReset();
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_sequences WHERE id = $1", { rows: [{ id: seq }], rowCount: 1 }],
      ["INSERT INTO bi_sequence_enrollments", { rows: [], rowCount: 0 }],
    ]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/marketing", biMarketingRoutes);
    const r = await request(app).post(`/api/v1/bi/marketing/sequences/${seq}/enroll`)
      .send({ contact_ids: ["11111111-1111-4111-8111-111111111111"] });
    expect(r.status).toBe(200);
    const [diag] = callsMatching(queryMock, "FROM unnest($2::uuid[])");
    const sql = sqlText(diag![0]).replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/e\.enrolled_at/);
    expect(sql).toMatch(/e\.started_at >= NOW\(\)/);
  });

  it("resume and stop write the column the worker schedules on", () => {
    const src = readFileSync("src/routes/biSequencesRoutes.ts", "utf-8");
    const worker = readFileSync("src/workers/marketingWorker.ts", "utf-8");
    expect(worker).toMatch(/e\.next_step_at <= NOW\(\)/);
    expect(src).toMatch(/status='active', next_step_at=/);
    expect(src).toMatch(/status='stopped', next_step_at=NULL/);
  });

  it("the v171 migration does not backfill from a nonexistent column", () => {
    const sql = readFileSync(
      "src/db/migrations/2026_09_14_bi_enrollments_created_at_v171.sql",
      "utf-8",
    );
    expect(sql).toContain("BI_ENROLL_LIVE_COLUMNS_v175");
    expect(sql).not.toMatch(/SET created_at = COALESCE\(created_at, enrolled_at/);
  });
});
