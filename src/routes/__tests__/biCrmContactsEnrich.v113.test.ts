import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("pg", () => ({
  Pool: class {
    query(...args: unknown[]) {
      return queryMock(...args);
    }
  },
}));

const matchPersonMock = vi.fn();
vi.mock("../../integrations/apollo/apolloClient", async () => {
  class ApolloError extends Error {
    constructor(public readonly status: number, public readonly body: unknown) {
      super(`Apollo API error: ${status}`);
      this.name = "ApolloError";
    }
  }
  return {
    ApolloError,
    matchPerson: (...args: unknown[]) => matchPersonMock(...args),
  };
});

const { SECRET } = vi.hoisted(() => ({ SECRET: "test-shared-secret-min-10" }));
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET, DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", requireAuth, biCrmRoutes);
  return app;
}

function staffToken(capabilities = ["crm:read", "marketing:outreach"]) {
  return jwt.sign({ staffUserId: "staff-1", role: "staff", capabilities }, SECRET);
}

describe("Block 113 — CRM contact Apollo enrichment", () => {
  beforeEach(() => {
    queryMock.mockReset();
    matchPersonMock.mockReset();
  });

  it("updates non-manual contact fields and writes an enriched activity", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "c1", email: "jane@example.com", manually_edited_fields: ["title"] }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    matchPersonMock.mockResolvedValueOnce({
      person: {
        title: "CEO",
        organization: { name: "Acme", industry: "Finance" },
        linkedin_url: "https://linkedin.com/in/jane",
        phone_numbers: [{ raw_number: "+14165551234" }],
        city: "Toronto",
        state: "ON",
        country: "Canada",
      },
    });

    const r = await request(makeApp())
      .post("/api/v1/bi/crm/contacts/c1/enrich")
      .set("Authorization", `Bearer ${staffToken()}`);

    expect(r.status).toBe(200);
    expect(r.body.changed_fields).not.toContain("title");
    expect(r.body.changed_fields).toContain("organization_name");
    expect(queryMock).toHaveBeenCalledTimes(3);
    const [updateSql, updateParams] = queryMock.mock.calls[1];
    expect(String(updateSql)).toContain("organization_name");
    expect(String(updateSql)).not.toContain("title =");
    expect(updateParams).toContain("Acme");
    const [activitySql, activityParams] = queryMock.mock.calls[2];
    expect(String(activitySql)).toContain("bi_contact_activity");
    expect(String(activitySql)).toContain("'enriched'");
    expect(String(activityParams[1])).toContain("organization_name");
  });
});
