// BI_SERVER_BLOCK_v256_CRM_COMPANIES_v1 — integration test (real Postgres).
// Converted from mock-pool.query assertions to behaviour against the test DB
// provisioned by the v356 harness (vitest.globalSetup + integrationDb.resetDb).
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";
import { resetDb, seedCompany, seedContact } from "../../test-support/integrationDb";

const SECRET = process.env.JWT_SECRET || "test-shared-secret-min-10";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/crm", requireAuth, biCrmRoutes);
  return app;
}
function token() {
  return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
}
function authed(method: "get" | "post" | "patch", path: string) {
  return (request(makeApp()) as any)[method](path).set(
    "Authorization",
    `Bearer ${token()}`,
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("BI_SERVER_BLOCK_v256 — GET /crm/companies list", () => {
  it("returns rows with contact_count rollup", async () => {
    const co = await seedCompany({ legal_name: "Acme Inc", operating_name: "Acme", industry: "Software" });
    await seedContact(co.id);
    await seedContact(co.id);
    await seedContact(co.id);
    const r = await authed("get", "/api/v1/bi/crm/crm/companies");
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    const row = body.find((x: any) => x.id === co.id);
    expect(row.contact_count).toBe(3);
  });

  it("filters by q (ILIKE) when provided", async () => {
    await seedCompany({ legal_name: "Acme Inc" });
    await seedCompany({ legal_name: "Globex Corp" });
    const r = await authed("get", "/api/v1/bi/crm/crm/companies?q=acme");
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body).toHaveLength(1);
    expect(body[0].legal_name).toBe("Acme Inc");
  });

  it("ignores an unknown/injection sort column and still returns 200", async () => {
    await seedCompany({ legal_name: "Acme Inc" });
    const r = await authed("get", "/api/v1/bi/crm/crm/companies?sort=injection;DROP");
    expect(r.status).toBe(200);
  });

  it("applies asc ordering when given a known sort column", async () => {
    await seedCompany({ legal_name: "Bravo" });
    await seedCompany({ legal_name: "Alpha" });
    const r = await authed("get", "/api/v1/bi/crm/crm/companies?sort=name:asc");
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    const names = body.map((x: any) => x.legal_name);
    expect(names).toEqual(["Alpha", "Bravo"]);
  });
});

describe("BI_SERVER_BLOCK_v256 — GET /crm/companies/:id detail", () => {
  it("returns company + contacts + applications", async () => {
    const co = await seedCompany({ legal_name: "Acme Inc" });
    await seedContact(co.id, { full_name: "Jane Doe" });
    const r = await authed("get", `/api/v1/bi/crm/crm/companies/${co.id}`);
    expect(r.status).toBe(200);
    const body = r.body?.data ?? r.body;
    expect(body.company.legal_name).toBe("Acme Inc");
    expect(Array.isArray(body.contacts)).toBe(true);
    expect(body.contacts).toHaveLength(1);
    expect(Array.isArray(body.applications)).toBe(true);
  });

  it("404s on missing", async () => {
    const r = await authed("get", "/api/v1/bi/crm/crm/companies/00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe(404);
  });
});

describe("BI_SERVER_BLOCK_v256 — POST /crm/companies", () => {
  it("400s without legal_name", async () => {
    const r = await authed("post", "/api/v1/bi/crm/crm/companies").send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("legal_name_required");
  });

  it("201s with a generated id on success", async () => {
    const r = await authed("post", "/api/v1/bi/crm/crm/companies").send({ legal_name: "New Co" });
    expect(r.status).toBe(201);
    expect(typeof r.body.id).toBe("string");
    expect(r.body.id.length).toBeGreaterThan(0);
  });
});

describe("BI_SERVER_BLOCK_v256 — PATCH /crm/companies/:id", () => {
  it("returns no_op on empty body", async () => {
    const co = await seedCompany({ legal_name: "Acme Inc" });
    const r = await authed("patch", `/api/v1/bi/crm/crm/companies/${co.id}`).send({});
    expect(r.body.no_op).toBe(true);
  });

  it("updates allowed fields and persists", async () => {
    const co = await seedCompany({ legal_name: "Acme Inc" });
    const r = await authed("patch", `/api/v1/bi/crm/crm/companies/${co.id}`).send({ operating_name: "Acme Operating" });
    expect(r.status).toBe(200);
    const detail = await authed("get", `/api/v1/bi/crm/crm/companies/${co.id}`);
    const body = detail.body?.data ?? detail.body;
    expect(body.company.operating_name).toBe("Acme Operating");
  });

  it("400s when trying to clear legal_name", async () => {
    const co = await seedCompany({ legal_name: "Acme Inc" });
    const r = await authed("patch", `/api/v1/bi/crm/crm/companies/${co.id}`).send({ legal_name: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("legal_name_required");
  });

  it("404s when company is missing", async () => {
    const r = await authed("patch", "/api/v1/bi/crm/crm/companies/00000000-0000-0000-0000-000000000000").send({ operating_name: "X" });
    expect(r.status).toBe(404);
  });
});
