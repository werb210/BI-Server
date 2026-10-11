// BI_SERVER_BLOCK_v520_PUBLIC_SUBMIT_REJECTION_LOG
// Rewritten (v789, audit [5]/[37]) from source-text assertions to behaviour:
// every refused public submit is logged with its code and field NAMES.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const warn = vi.fn();
vi.mock("../platform/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), info: vi.fn() } }));
vi.mock("../services/notifyBiClient", () => ({ notifyBiClient: vi.fn().mockResolvedValue({ channel: "push" }) }));

import router from "../routes/biPublicApplicationRoutes";

const app = express().use(express.json()).use("/api/v1", router);
const rejected = () => warn.mock.calls.filter((c) => c[1] === "bi_public_submit_rejected");
const row = { id: "app-1", public_id: "ABCDEFGH", score_decision: "approve", status: "created", source: "public", guarantor_name: "Jane Secret" };

describe("v520 applicant submit refusals are logged", () => {
  beforeEach(() => {
    warn.mockReset();
    queryMock.mockReset();
  });

  it("logs code + field names (never values) on a 4xx", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [row] }]]));
    const res = await request(app).post("/api/v1/applications/ABCDEFGH/submit").send({});
    expect(res.status).toBe(400);
    const logs = rejected();
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toMatchObject({ publicId: "ABCDEFGH", status: 400, error: "missing_fields" });
    expect(logs[0][0].fields).toContain("guarantor_email");
    expect(JSON.stringify(logs[0][0])).not.toContain("Jane Secret");
  });

  it("logs a 404 too", async () => {
    queryMock.mockImplementation(answerBySql([]));
    await request(app).post("/api/v1/applications/NOPE/submit").send({});
    expect(rejected()[0][0]).toMatchObject({ status: 404, error: "not_found" });
  });

  it("does not log a successful (idempotent) submit", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...row, status: "in_progress" }] }]]));
    const res = await request(app).post("/api/v1/applications/ABCDEFGH/submit").send({});
    expect(res.status).toBe(200);
    expect(rejected()).toHaveLength(0);
  });
});
