// BI_APPLICANT_ACTION_CENTER_v199
// BI_SERVER_v789 [5]/[37] - the route check is a behaviour test now (the real
// biApplicantSubmitRoutes router, ../../db mocked by SQL content). The
// service checks below still read biActionCenter / pgiCompletion source.
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { applicantBearer } from "../../__tests__/helpers/realApp";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import submitRouter from "../../routes/biApplicantSubmitRoutes";

const svc = readFileSync("src/services/biApplicantActions.ts", "utf-8");
const completion = readFileSync("src/services/pgiCompletion.ts", "utf-8");

describe("bi action center", () => {
  it("applies the same catalog rules as pgiCompletion", () => {
    for (const rule of ["c.active = TRUE", "COALESCE(c.required, TRUE) = TRUE"]) {
      expect(svc).toContain(rule);
      expect(completion).toContain(rule);
    }
  });

  it("does not count a rejected upload as satisfied", () => {
    expect(svc).toContain("COALESCE(d.review_status, 'pending') <> 'rejected'");
    expect(svc).toContain("if (r.satisfied && !r.rejected) completed.push(item)");
  });

  it("ignores purged documents", () => {
    expect(svc.match(/d\.purged_at IS NULL/g)?.length).toBe(2);
  });

  it("puts rejected documents first", () => {
    expect(svc).toContain("Number(b.urgent) - Number(a.urgent)");
  });

  it("degrades to an empty list rather than throwing", () => {
    // BI_SERVER_LOGGED_FALLBACKS_v712 - still degrades to empty, but now logs why.
    expect(svc.match(/\.catch\(loggedFallback\("biApplicantActions#[12]", \{ rows: \[\] as any\[\] \}\)\)/g)?.length).toBe(2);
  });

  it("only reports canSubmit when nothing at all is outstanding", () => {
    expect(svc).toContain("canSubmit: outstanding.length === 0");
  });
});

describe("route", () => {
  const PHONE = "+14165550199";
  const app = express().use(express.json()).use("/api/v1", submitRouter);
  const owned = { id: "app-199", public_id: "PUB199", country: "CA", status: "in_progress", data: {}, applicant_phone_e164: null, guarantor_phone: PHONE };

  it("resolves an applicant-owned public id and rejects an unknown application", async () => {
    queryMock.mockReset().mockImplementation(answerBySql([
      ["FROM bi_applications WHERE public_id = $1", { rows: [owned] }],
      ["FROM bi_required_doc_catalog c", { rows: [{ doc_type: "profit_loss", display_label: "P&L", satisfied: false, rejected: true }] }],
    ]));
    const ok = await request(app).get("/api/v1/action-center/PUB199").set("Authorization", applicantBearer(PHONE));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ applicationId: "PUB199", outstandingCount: 1, canSubmit: false });
    expect(ok.body.outstanding[0]).toMatchObject({ key: "upload:profit_loss", urgent: true });
    expect(callsMatching(queryMock, "FROM bi_applications WHERE public_id = $1")[0][1]).toEqual(["PUB199"]);
    expect(callsMatching(queryMock, "FROM bi_required_doc_catalog c")[0][1]).toEqual(["app-199"]);

    const other = await request(app).get("/api/v1/action-center/PUB199").set("Authorization", applicantBearer("+14165550998"));
    expect(other.status).toBe(403);
    expect(other.body.error).toBe("not_owner");

    queryMock.mockReset().mockImplementation(answerBySql([]));
    const missing = await request(app).get("/api/v1/action-center/NOPE").set("Authorization", applicantBearer(PHONE));
    expect(missing.status).toBe(404);
    expect(callsMatching(queryMock, "bi_required_doc_catalog")).toHaveLength(0);

    expect((await request(app).get("/api/v1/action-center/PUB199")).status).toBe(401);
  });
});
