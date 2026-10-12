// v789 [5]/[37]: the biMarketingRoutes.ts greps are now enroll requests to the
// real router. The skip diagnostic is read from the SQL actually sent to the
// mocked pool (comments stripped where the assertion is about columns). The
// migration checks read a .sql file and stay.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "src/db/migrations/2026_09_14_bi_enrollments_created_at_v171.sql"),
  "utf8",
);

const SEQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REASONS = ["not_found", "no_email", "no_consent_basis", "consent_expired", "suppressed", "already_enrolled"];
const IDS = REASONS.map((_, i) => `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`);

let diagnosticRows: Array<{ id: string; reason: string }> = [];
beforeEach(() => {
  diagnosticRows = IDS.map((id, i) => ({ id, reason: REASONS[i]! }));
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    ["FROM bi_sequences WHERE id = $1", { rows: [{ id: SEQ }], rowCount: 1 }],
    ["SELECT delay_seconds FROM bi_sequence_steps", { rows: [{ delay_seconds: 0 }], rowCount: 1 }],
    ["INSERT INTO bi_sequence_enrollments", { rows: [], rowCount: 0 }],
    ["FROM unnest($2::uuid[])", () => ({ rows: diagnosticRows, rowCount: diagnosticRows.length })],
  ]));
});

async function enrollAndReadDiagnostic() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/marketing", biMarketingRoutes);
  const r = await request(app).post(`/api/v1/bi/marketing/sequences/${SEQ}/enroll`).send({ contact_ids: IDS });
  const [diag] = callsMatching(queryMock, "FROM unnest($2::uuid[])");
  expect(diag).toBeDefined();
  const text = sqlText(diag![0]);
  return { r, text, sql: text.replace(/--[^\n]*/g, "") };
}

describe("BI_SEQ_ENROLL_DIAG_COLUMN_v171", () => {
  it("no longer reads a column the live table lacks", async () => {
    // Postgres threw 42703 "column e.created_at does not exist" on every
    // enroll, so the skip reason never reached the response.
    const { r, sql } = await enrollAndReadDiagnostic();
    expect(sql).not.toMatch(/\be\.created_at\b/);
    expect(r.status).toBe(200);
    expect(r.body.skips).toHaveLength(REASONS.length);
  });

  // BI_ENROLL_LIVE_COLUMNS_v175 - the live table is the v280 shape, whose
  // timestamp is started_at.
  it("reads started_at, which is the column the live table has", async () => {
    const { sql } = await enrollAndReadDiagnostic();
    expect(sql).toContain("e.started_at >= NOW() - interval '1 minute'");
  });

  it("reads neither dead column name in the diagnostic SQL", async () => {
    const { sql } = await enrollAndReadDiagnostic();
    expect(sql).not.toMatch(/\be\.created_at\b/);
    expect(sql).not.toMatch(/\be\.enrolled_at\b/);
  });

  it("explains which of the two table definitions actually applied", async () => {
    // The explanation travels with the statement as an SQL comment.
    const { text } = await enrollAndReadDiagnostic();
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(text).toContain("v110");
  });

  it("adds the column idempotently rather than recreating the table", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS created_at");
    expect(migration.toUpperCase()).not.toContain("DROP");
    expect(migration.toUpperCase()).not.toContain("TRUNCATE");
  });

  // BI_ENROLL_LIVE_COLUMNS_v175 - the migration resolves the backfill source
  // from information_schema instead of hardcoding one.
  it("resolves the backfill source at runtime instead of hardcoding one", () => {
    expect(migration).toContain("information_schema.columns");
    expect(migration).toContain("'started_at', 'enrolled_at'");
    expect(migration).toContain("EXECUTE format(");
    expect(migration).not.toContain("COALESCE(created_at, enrolled_at, NOW())");
  });

  it("leaves created_at non-null once the migration has run", () => {
    expect(migration).toContain("WHERE created_at IS NULL");
    expect(migration).toContain("ALTER COLUMN created_at SET DEFAULT NOW()");
  });

  it("still reports the other skip reasons the enroll can produce", async () => {
    const { r, sql } = await enrollAndReadDiagnostic();
    for (const reason of REASONS) expect(sql).toContain(`'${reason}'`);
    expect(r.body).toMatchObject({ inserted: 0, skipped: REASONS.length, requested: REASONS.length });
    expect(r.body.skips).toEqual(IDS.map((id, i) => ({ contact_id: id, reason: REASONS[i] })));
  });
});
