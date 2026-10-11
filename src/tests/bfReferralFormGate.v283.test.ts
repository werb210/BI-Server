// BI_SERVER_BF_REFERRAL_FORM_v283
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const putMock = vi.fn();
vi.mock("../lib/storage", () => ({ getStorage: () => ({ put: (...a: unknown[]) => putMock(...a) }) }));
vi.mock("../services/ocrRunner", () => ({ runOcrForDocument: vi.fn().mockResolvedValue(undefined) }));

import router from "../routes/biPublicApplicationRoutes";
import { passesScoreGate, withDateOnlyFields } from "../services/biPublicFormGates";

describe("CORE score gate on the public form", () => {
  it("lets a BF referral save and submit before anyone has scored it", () => {
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: null })).toBe(true);
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: "error" })).toBe(true);
  });
  it("still blocks a declined BF referral and unscored public applications", () => {
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: "decline" })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: null })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: "decline" })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: "approve" })).toBe(true);
  });
});

describe("dates the form can show", () => {
  it("turns DATE columns into yyyy-mm-dd and leaves other fields alone", () => {
    const row = withDateOnlyFields({ guarantor_dob: new Date("1971-04-14T00:00:00.000Z"), formation_date: "2022-05-03T00:00:00.000Z", created_at: new Date("2026-09-15T19:36:08Z"), guarantor_name: "Todd" });
    expect(row.guarantor_dob).toBe("1971-04-14");
    expect(row.formation_date).toBe("2022-05-03");
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.guarantor_name).toBe("Todd");
  });
});

// Rewritten (v789, audit [5]/[37]) from a source-text count of passesScoreGate(
// calls to behaviour: save, submit and document upload all apply the gate, and
// the read returns date-only fields.
describe("wiring", () => {
  const unscoredBf = { id: "app-1", public_id: "ABCDEFGH", source: "bf_pgi_referral", score_decision: null, status: "in_progress" };
  const unscoredPublic = { ...unscoredBf, source: "public" };
  const app = () => express().use(express.json()).use(router);
  const PDF = Buffer.from("%PDF-1.4\n");

  beforeEach(() => {
    putMock.mockReset().mockResolvedValue({ blobName: "b", url: "u", hash: "h", sizeBytes: 1 });
    queryMock.mockReset();
  });

  it("save, submit and document upload all refuse an unscored public application", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [unscoredPublic] }]]));
    expect((await request(app()).patch("/applications/ABCDEFGH").send({ business_name: "x" })).status).toBe(403);
    expect((await request(app()).post("/applications/ABCDEFGH/submit").send({})).status).toBe(403);
    const up = await request(app()).post("/applications/ABCDEFGH/documents")
      .field("doc_types", "profit_loss").attach("files", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(403);
    expect(up.body.error).toBe("score_not_approved");
  });

  it("save, submit and document upload let a BF referral through before scoring", async () => {
    queryMock.mockImplementation(answerBySql([
      ["FROM bi_applications", { rows: [unscoredBf] }],
      ["INSERT INTO bi_documents", { rows: [{ id: "d1" }] }],
    ]));
    expect((await request(app()).patch("/applications/ABCDEFGH").send({ business_name: "x" })).status).toBe(200);
    // in_progress: submit is the idempotent no-op, past the gate.
    expect((await request(app()).post("/applications/ABCDEFGH/submit").send({})).body).toMatchObject({ ok: true, idempotent: true });
    const up = await request(app()).post("/applications/ABCDEFGH/documents")
      .field("doc_types", "profit_loss").attach("files", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(200);
  });

  it("the read returns DATE columns as yyyy-mm-dd", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...unscoredBf, guarantor_dob: new Date("1971-04-14T00:00:00.000Z") }] }]]));
    const res = await request(app()).get("/applications/ABCDEFGH");
    expect(res.body.application.guarantor_dob).toBe("1971-04-14");
  });
});
