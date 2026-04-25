import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import pgiRoutes from "../routes/pgiRoutes";
import pgiApiRoutes from "../routes/pgiApiRoutes";
import { pool } from "../db";
import { resetPGISubmitterForTests, setPGISubmitterForTests } from "../controllers/pgiController";
import app from "../server";
import { signStaffToken } from "../platform/auth";

const originalQuery = pool.query.bind(pool);

function makeApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/pgi", pgiRoutes);
  app.use("/api/v1", pgiApiRoutes);
  return app;
}

test.afterEach(() => {
  pool.query = originalQuery;
  resetPGISubmitterForTests();
});

test("POST /api/pgi/submit returns 200 and externalId", async () => {
  const saved = new Map<string, Record<string, unknown>>();
  pool.query = (async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO pgi_applications")) {
      saved.set(String(params[0]), JSON.parse(String(params[1])) as Record<string, unknown>);
      return { rows: [], rowCount: 1 } as never;
    }

    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  setPGISubmitterForTests(async () => ({ externalId: "ext-100", status: "submitted" }));

  const app = makeApp();
  const res = await request(app).post("/api/pgi/submit").send({
    id: "app-100",
    businessName: "Acme",
    firstName: "A",
    lastName: "B",
    email: "a@b.com",
    phone: "111",
    loanAmount: 100000,
    loanType: "secured",
    coveragePercent: 80
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.externalId, "ext-100");
  assert.equal(saved.get("app-100")?.stage, "Application Submitted");
});

test("POST /api/pgi/webhook maps approved status correctly", async () => {
  const saved = new Map<string, Record<string, unknown>>();
  saved.set("app-1", { externalId: "test123", stage: "Application Submitted", timeline: [] });

  pool.query = (async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT id, data") && sql.includes("externalId")) {
      const id = String(params[0]);
      if (id === "test123") {
        return { rows: [{ id: "app-1", data: saved.get("app-1") }] } as never;
      }
      return { rows: [] } as never;
    }

    if (sql.includes("UPDATE pgi_applications SET data")) {
      saved.set(String(params[0]), JSON.parse(String(params[1])) as Record<string, unknown>);
      return { rows: [], rowCount: 1 } as never;
    }

    return { rows: [] } as never;
  }) as typeof pool.query;

  const app = makeApp();
  const res = await request(app).post("/api/pgi/webhook").send({ id: "test123", status: "approved" });

  assert.equal(res.status, 200);
  assert.equal(res.body.mappedStatus, "Approved");
  assert.equal(saved.get("app-1")?.stage, "Approved");
});

test("E2E flow: quote -> application -> submit -> webhook -> pipeline", async () => {
  const records = new Map<string, Record<string, unknown>>();

  pool.query = (async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO pgi_applications(id, data)")) {
      records.set(String(params[0]), JSON.parse(String(params[1])) as Record<string, unknown>);
      return { rows: [], rowCount: 1 } as never;
    }

    if (sql.includes("INSERT INTO pgi_applications(id, data)") || sql.includes("INSERT INTO pgi_applications(data)")) {
      return { rows: [], rowCount: 1 } as never;
    }

    if (sql.includes("SELECT id, data") && sql.includes("externalId")) {
      const external = String(params[0]);
      for (const [id, data] of records.entries()) {
        if (data.externalId === external || id === external) {
          return { rows: [{ id, data }] } as never;
        }
      }
      return { rows: [] } as never;
    }

    if (sql.includes("UPDATE pgi_applications SET data")) {
      records.set(String(params[0]), JSON.parse(String(params[1])) as Record<string, unknown>);
      return { rows: [], rowCount: 1 } as never;
    }

    if (sql.includes("SELECT id, data FROM pgi_applications")) {
      return {
        rows: Array.from(records.entries()).map(([id, data]) => ({ id, data }))
      } as never;
    }

    if (sql.includes("SELECT data FROM pgi_applications")) {
      return {
        rows: Array.from(records.values()).map((data) => ({ data }))
      } as never;
    }

    return { rows: [] } as never;
  }) as typeof pool.query;

  setPGISubmitterForTests(async () => ({ externalId: "ext-e2e", status: "submitted" }));

  const app = makeApp();

  const quoteRes = await request(app).post("/api/v1/quote").send({
    loanAmount: 100000,
    coveragePercent: 80,
    loanType: "secured"
  });
  assert.equal(quoteRes.status, 200);
  assert.equal(quoteRes.body.data.maxCoverage, 0.8);

  const submitRes = await request(app).post("/api/pgi/submit").send({
    id: "app-e2e",
    businessName: "E2E Corp",
    firstName: "Alex",
    lastName: "R",
    email: "alex@corp.com",
    phone: "222",
    loanAmount: 100000,
    loanType: "secured",
    coveragePercent: 80,
    lenderId: "lender-1",
    documents: [{ type: "financials", base64: "abc123" }]
  });
  assert.equal(submitRes.status, 200);

  const webhookRes = await request(app).post("/api/pgi/webhook").send({ id: "ext-e2e", status: "approved" });
  assert.equal(webhookRes.status, 200);

  const pipelineRes = await request(app).get("/api/v1/pipeline/lender/lender-1");
  assert.equal(pipelineRes.status, 200);
  assert.equal(pipelineRes.body.data[0].stage, "Approved");
});


test("Smoke: public BI applications index is not mounted", async () => {
  const res = await request(app).get("/api/v1/applications");
  assert.equal(res.status, 404);
});

test("Smoke: quote estimate requires auth", async () => {
  const res = await request(app).post("/api/v1/bi/quote/estimate").send({
    facilityType: "secured",
    loanAmount: 100000
  });

  assert.equal(res.status, 401);
});

test("Smoke: quote estimate succeeds with auth", async () => {
  const token = signStaffToken({
    staffUserId: "test-user",
    role: "applicant",
    phone: "+15555550000",
    userType: "applicant"
  });

  const res = await request(app)
    .post("/api/v1/bi/quote/estimate")
    .set("Authorization", `Bearer ${token}`)
    .send({ facilityType: "secured", loanAmount: 100000 });

  assert.equal(res.status, 200);
});
