// BI_CLIENT_SUBMIT_v25 - step 4 review + submit.
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour
// tests against the router with the database mocked by SQL content.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import router from "../biApplicantSubmitRoutes";
import { signBiToken } from "../../platform/serviceTokens";

const PHONE = "+14165550111";
const token = (phone = PHONE) => signBiToken({ kind: "applicant", phone }, "1h", String(process.env.JWT_SECRET));
const app = express().use(express.json()).use("/api/v1", router);

const appRow = {
  id: "app-1", public_id: "PUB12345", country: "CA", status: "in_progress",
  data: { businessName: "Acme", applicantName: "Jane", email: "j@example.com" },
  applicant_phone_e164: PHONE, guarantor_phone: null,
};

type Opts = { coverages?: unknown[]; referrals?: unknown[]; outstanding?: unknown[]; advanced?: boolean; app?: unknown };
function db(o: Opts = {}) {
  queryMock.mockImplementation(answerBySql([
    [/SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone/, { rows: o.app === undefined ? [appRow] : o.app ? [o.app] : [] }],
    ["FROM bi_application_products ap JOIN bi_products p", { rows: o.coverages ?? [{ code: "pgi", display_name: "PGI", source: "selected" }] }],
    ["FROM bi_documents", { rows: [{ original_filename: "pl.pdf", doc_type: "profit_loss" }] }],
    ["COUNT(*)::text AS n", { rows: [{ n: "7" }] }],
    ["q.required = TRUE", { rows: o.outstanding ?? [] }],
    ["FROM bi_coverage_gaps g", { rows: o.referrals ?? [] }],
    ["SELECT question_key, value FROM bi_application_answers", { rows: [{ question_key: "naics_code", value: "236220" }] }],
    ["SET status = 'ready_for_submission'", { rows: o.advanced === false ? [] : [{ status: "ready_for_submission" }], rowCount: o.advanced === false ? 0 : 1 }],
  ]));
}

beforeEach(() => queryMock.mockReset());

describe("step 4 endpoints", () => {
  it("exposes a review summary and a submit", async () => {
    db();
    const s = await request(app).get("/api/v1/applicants/applications/PUB12345/summary").set("Authorization", `Bearer ${token()}`);
    expect(s.status).toBe(200);
    db();
    const p = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(p.status).toBe(200);
  });

  it("is ownership-checked and resolves me", async () => {
    db();
    const other = await request(app).get("/api/v1/applicants/applications/PUB12345/summary").set("Authorization", `Bearer ${token("+14165550999")}`);
    expect(other.status).toBe(403);
    expect(other.body.error).toBe("not_owner");

    db({ app: null });
    const missing = await request(app).get("/api/v1/applicants/applications/NOPE/summary").set("Authorization", `Bearer ${token()}`);
    expect(missing.status).toBe(404);

    db();
    const me = await request(app).get("/api/v1/applicants/applications/me/summary").set("Authorization", `Bearer ${token()}`);
    expect(me.status).toBe(200);
    expect(me.body.applicationId).toBe("PUB12345");
    const lookup = callsMatching(queryMock, /applicant_phone_e164 = \$1 OR guarantor_phone = \$1/)[0];
    expect(lookup[1]).toEqual([PHONE]);
  });

  it("requires an applicant bearer", async () => {
    db();
    expect((await request(app).get("/api/v1/applicants/applications/PUB12345/summary")).status).toBe(401);
  });
});

describe("submission is gated server-side", () => {
  it("refuses with no coverage selected", async () => {
    db({ coverages: [], referrals: [] });
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no_coverage_selected");
    expect(callsMatching(queryMock, "ready_for_submission")).toHaveLength(0);
  });

  it("refuses while required questions are unanswered (the query counts unexplained adverse answers)", async () => {
    db({ outstanding: [{ question_key: "q1", prompt: "Any claims?" }] });
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("questions_outstanding");
    expect(r.body.outstanding).toEqual([{ questionKey: "q1", prompt: "Any claims?" }]);
    const q = String(callsMatching(queryMock, "q.required = TRUE")[0][0]);
    expect(q).toContain("q.adverse_answer IS NOT NULL AND a.value = q.adverse_answer");
    expect(q).toContain("COALESCE(TRIM(a.reason),'') = ''");
  });

  it("does not trust a client-side completeness count", async () => {
    db({ coverages: [] });
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({ canSubmit: true });
    expect(r.status).toBe(400);
  });

  it("allows a referral-only submission", async () => {
    db({ coverages: [], referrals: [{ coverage_code: "cyber", display_name: "Cyber", requested_limit: 1, status: "open" }] });
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(r.status).toBe(200);
  });
});

describe("the status it sets", () => {
  it("uses ready_for_submission, not submitted, only from created / in_progress", async () => {
    db();
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.alreadySubmitted).toBe(false);
    const upd = String(callsMatching(queryMock, "ready_for_submission")[0][0]);
    expect(upd).toContain("AND status IN ('created','in_progress')");
    expect(callsMatching(queryMock, "SET status = 'submitted'")).toHaveLength(0);
  });

  it("a resubmit is a no-op reported as alreadySubmitted", async () => {
    db({ advanced: false });
    const r = await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.alreadySubmitted).toBe(true);
    expect(callsMatching(queryMock, "application_submitted")).toHaveLength(0);
  });

  it("projects the answers into data before the status changes", async () => {
    db();
    await request(app).post("/api/v1/applicants/applications/PUB12345/submit").set("Authorization", `Bearer ${token()}`).send({});
    const texts = queryMock.mock.calls.map((c) => String(c[0]));
    const proj = texts.findIndex((t) => t.includes("SET data = COALESCE(data,'{}'::jsonb) || $2::jsonb"));
    const status = texts.findIndex((t) => t.includes("SET status = 'ready_for_submission'"));
    expect(proj).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(proj);
    const projCall = callsMatching(queryMock, "SET data = COALESCE")[0];
    expect(JSON.parse(String((projCall[1] as unknown[])[1]))).toMatchObject({ naics_code: "236220" });
  });
});

describe("the summary shows what was actually captured", () => {
  it("returns coverages, documents, the answered count and the step 1 details; purged documents are excluded", async () => {
    db();
    const r = await request(app).get("/api/v1/applicants/applications/PUB12345/summary").set("Authorization", `Bearer ${token()}`);
    expect(r.body).toMatchObject({
      applicationId: "PUB12345", country: "CA", businessName: "Acme", applicantName: "Jane", email: "j@example.com",
      coverages: [{ code: "pgi" }], documents: [{ doc_type: "profit_loss" }], answered: 7, canSubmit: true,
    });
    expect(String(callsMatching(queryMock, "FROM bi_documents")[0][0])).toContain("purged_at IS NULL");
  });
});
