// BI_SERVER_BLOCK_v367_DEMO_SESSION_AUTH_v1
// The demo-session endpoints need an authenticated real lender, refuse nested
// demos, carry originating_lender_id, and 503 when no demo lender exists.
// Behaviour test (BI_SERVER_v789: rewritten from a source-text test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import biLenderApiRoutes from "../biLenderApiRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const REAL = "11111111-1111-4111-8111-111111111111";
const DEMO = "99999999-9999-4999-8999-999999999999";
const SECRET = () => process.env.JWT_SECRET as string;
let demoProvisioned = true;

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", biLenderApiRoutes);
  return a;
}
beforeEach(() => {
  resetLenderActiveCache();
  demoProvisioned = true;
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["WHERE is_demo = TRUE AND is_active = TRUE", () => ({ rows: demoProvisioned ? [{ id: DEMO, company_name: "Demo Lender" }] : [] })],
  ]));
});

describe("v367 - demo session endpoint requires authLender", () => {
  for (const path of ["/api/v1/lender/demo-session", "/api/v1/lender/demo/session"]) {
    it(`${path}: anonymous POST is refused`, async () => {
      const r = await request(app()).post(path).send({});
      expect(r.status).toBe(401);
    });

    it(`${path}: a real lender gets a demo JWT naming the originating lender`, async () => {
      const r = await request(app()).post(path).set("Authorization", `Bearer ${signBiToken({ kind: "lender", id: REAL }, "1h", SECRET())}`).send({});
      expect(r.status).toBe(200);
      const claims: any = jwt.verify(r.body.token, SECRET());
      expect(claims).toMatchObject({ kind: "lender", id: DEMO, is_demo: true, originating_lender_id: REAL });
    });
  }

  it("rejects a nested demo (caller already on a demo token)", async () => {
    const r = await request(app()).post("/api/v1/lender/demo/session").set("Authorization", `Bearer ${signBiToken({ kind: "lender", id: DEMO, is_demo: true }, "1h", SECRET())}`).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("already_demo");
  });

  it("503 when no demo lender is provisioned", async () => {
    demoProvisioned = false;
    const r = await request(app()).post("/api/v1/lender/demo/session").set("Authorization", `Bearer ${signBiToken({ kind: "lender", id: REAL }, "1h", SECRET())}`).send({});
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("demo_lender_not_provisioned");
  });
});
