// BI_SERVER_BLOCK_v253_APOLLO_PHASE1_SCAFFOLD_v1
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const { SECRET } = vi.hoisted(() => ({ SECRET: "test-shared-secret-min-10" }));
vi.mock("../../platform/env", () => ({
  env: { JWT_SECRET: SECRET, DATABASE_URL: "postgres://test" },
}));
vi.mock("../../platform/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const enrichMock = vi.fn();
const sequencesMock = vi.fn();
const enrollMock = vi.fn();
const mailboxesMock = vi.fn();
const liveMock = vi.fn();
vi.mock("../../services/apolloClient", () => ({
  apolloIsLive: () => liveMock(),
  enrichPerson: (...args: unknown[]) => enrichMock(...args),
  listSequences: (...args: unknown[]) => sequencesMock(...args),
  enrollContact: (...args: unknown[]) => enrollMock(...args),
  listMailboxes: (...args: unknown[]) => mailboxesMock(...args),
}));

import router from "../biApolloRoutes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
function staffToken() {
  return jwt.sign({ staffUserId: "staff-1", role: "staff" }, SECRET);
}

describe("BI_SERVER_BLOCK_v253 — GET /apollo/health", () => {
  beforeEach(() => {
    queryMock.mockReset();
    enrichMock.mockReset();
    sequencesMock.mockReset();
    enrollMock.mockReset();
    mailboxesMock.mockReset();
    liveMock.mockReset();
  });

  it("returns live=false + mock mailboxes when APOLLO_API_KEY is unset", async () => {
    liveMock.mockReturnValue(false);
    mailboxesMock.mockResolvedValueOnce({
      ok: true,
      mock: true,
      mailboxes: [{ id: "m1", email: "x@y.com" }],
    });
    const r = await request(makeApp())
      .get("/apollo/health")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.live).toBe(false);
    expect(r.body.mock).toBe(true);
    expect(r.body.mailboxes).toHaveLength(1);
  });
});

describe("BI_SERVER_BLOCK_v253 — POST /apollo/enrich/:id", () => {
  beforeEach(() => {
    queryMock.mockReset();
    enrichMock.mockReset();
  });

  it("404s when contact is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .post("/apollo/enrich/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(404);
  });

  it("enriches a contact and upserts into bi_apollo_enrichment", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ full_name: "Jane Doe", email: "jane@example.com", company_id: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // enrichment upsert
    enrichMock.mockResolvedValueOnce({
      ok: true,
      mock: false,
      person: {
        id: "apollo-p1",
        email: "jane@example.com",
        title: "CFO",
        linkedin_url: "https://linkedin.com/in/jane",
        organization: { name: "Acme", primary_domain: "acme.com" },
        seniority: "vp",
      },
      raw: { foo: "bar" },
    });

    const r = await request(makeApp())
      .post("/apollo/enrich/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.person.title).toBe("CFO");
    expect(r.body.mock).toBe(false);
    // 2 queries: contact lookup + enrichment upsert.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT write to bi_apollo_enrichment when Apollo returns no match", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ full_name: "Ghost", email: null, company_id: null }],
    });
    enrichMock.mockResolvedValueOnce({
      ok: true,
      mock: false,
      person: null,
      raw: {},
    });
    const r = await request(makeApp())
      .post("/apollo/enrich/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.person).toBeNull();
    // Only the contact lookup; no upsert.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe("BI_SERVER_BLOCK_v253 — GET /apollo/sequences", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sequencesMock.mockReset();
    liveMock.mockReset();
  });

  it("lists local rows without syncing by default", async () => {
    liveMock.mockReturnValue(false);
    queryMock.mockResolvedValueOnce({ rows: [{ id: "s1", name: "Seq" }] });
    const r = await request(makeApp())
      .get("/apollo/sequences")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.sequences).toHaveLength(1);
    expect(sequencesMock).not.toHaveBeenCalled();
  });

  it("syncs from Apollo when ?sync=true", async () => {
    liveMock.mockReturnValue(true);
    sequencesMock.mockResolvedValueOnce({
      ok: true,
      mock: false,
      sequences: [{ id: "apollo-1", name: "Cold outreach", active: true }],
    });
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // upsert
      .mockResolvedValueOnce({ rows: [{ id: "s1", name: "Cold outreach" }] });
    const r = await request(makeApp())
      .get("/apollo/sequences?sync=true")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(sequencesMock).toHaveBeenCalledTimes(1);
    expect(r.body.sequences).toHaveLength(1);
  });
});

describe("BI_SERVER_BLOCK_v253 — POST /apollo/sequences/:id/enroll/:contact_id", () => {
  beforeEach(() => {
    queryMock.mockReset();
    enrollMock.mockReset();
  });

  it("400s when contact has no email", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ apollo_sequence_id: "apollo-1", name: "Seq" }] })
      .mockResolvedValueOnce({ rows: [{ full_name: "Jane", email: null }] });
    const r = await request(makeApp())
      .post("/apollo/sequences/s1/enroll/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("contact_has_no_email");
  });

  it("404s when sequence is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await request(makeApp())
      .post("/apollo/sequences/s1/enroll/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("sequence_not_found");
  });

  it("enrolls and writes the enrollment row", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ apollo_sequence_id: "apollo-1", name: "Seq" }] })
      .mockResolvedValueOnce({ rows: [{ full_name: "Jane Doe", email: "jane@example.com" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // enrollment upsert
    enrollMock.mockResolvedValueOnce({
      ok: true,
      mock: false,
      apollo_contact_id: "apollo-c-99",
      raw: {},
    });
    const r = await request(makeApp())
      .post("/apollo/sequences/s1/enroll/c1")
      .set("Authorization", `Bearer ${staffToken()}`);
    expect(r.status).toBe(200);
    expect(r.body.apollo_contact_id).toBe("apollo-c-99");
    expect(enrollMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apollo_sequence_id: "apollo-1",
        email: "jane@example.com",
        first_name: "Jane",
        last_name: "Doe",
      }),
    );
  });
});
