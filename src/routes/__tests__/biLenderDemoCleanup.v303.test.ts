// BI_SERVER_BLOCK_v303_LENDER_DEMO_CLEANUP_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import biLenderApiRoutes from "../biLenderApiRoutes";
import { pool } from "../../db";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

vi.mock("../../db", async () => {
  const actual = await vi.importActual<any>("../../db");
  return {
    ...actual,
    pool: { query: vi.fn() },
  };
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", biLenderApiRoutes);
  return app;
}

function lenderToken(lenderId = "11111111-1111-4111-8111-111111111111") {
  return jwt.sign({ kind: "lender", id: lenderId }, process.env.JWT_SECRET as string);
}

describe("POST /api/v1/bi/lender/demo/cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLenderActiveCache();
    // BI_SERVER_v789_LENDER_ACTIVE - lender auth looks up the active flags first.
    (pool.query as any).mockImplementation(answerBySql([
      [/FROM bi_lenders l\s+LEFT JOIN bi_lender_login_contacts/, { rows: [{ lender_active: true, contact_active: null }], rowCount: 1 }],
      ["DELETE FROM bi_applications", { rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }],
    ]));
  });

  it("returns 400 when session_started_at is missing", async () => {
    const res = await request(buildApp())
      .post("/api/v1/bi/lender/demo/cleanup")
      .set("Authorization", `Bearer ${lenderToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "session_started_at_required" });
    expect(callsMatching(pool.query as any, "DELETE FROM bi_applications")).toHaveLength(0);
  });

  it("returns 400 when session_started_at is invalid", async () => {
    const res = await request(buildApp())
      .post("/api/v1/bi/lender/demo/cleanup")
      .set("Authorization", `Bearer ${lenderToken()}`)
      .send({ session_started_at: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "session_started_at_required" });
    expect(callsMatching(pool.query as any, "DELETE FROM bi_applications")).toHaveLength(0);
  });

  it("returns 200 and deleted count when valid", async () => {
    const input = "2026-05-19T00:00:00.000Z";

    const res = await request(buildApp())
      .post("/api/v1/bi/lender/demo/cleanup")
      .set("Authorization", `Bearer ${lenderToken()}`)
      .send({ session_started_at: input });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: 2 });
    const deletes = callsMatching(pool.query as any, "DELETE FROM bi_applications");
    expect(deletes).toHaveLength(1);
    const [sql, params] = deletes[0] as [string, unknown[]];
    expect(String(sql)).toContain("DELETE FROM bi_applications");
    expect(String(sql)).toContain("is_demo = TRUE");
    expect(String(sql)).toContain("created_by_lender_id = $1::uuid");
    expect(String(sql)).toContain("created_at >= $2::timestamptz");
    expect(params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      new Date(input).toISOString(),
    ]);
  });
});
