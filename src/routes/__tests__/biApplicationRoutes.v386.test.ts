// BI_SERVER_BLOCK_v386_PIPELINE_DOC_REVIEW_COLUMN_v1
// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep): both the
// pipeline listing and the detail map status 'document_review' to the
// 'document_review' column, never to 'under_review'.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import router from "../biApplicationRoutes";
import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const APP = "66666666-6666-4666-8666-666666666666";
function app() {
  const a = express();
  a.use("/api/v1/bi", router);
  return a;
}

describe("BI_SERVER_BLOCK_v386 - pipeline doc_review mapping", () => {
  beforeEach(() => {
    poolQuery.mockReset().mockImplementation(answerBySql([["FROM bi_applications a", { rows: [{ id: APP, effective_stage: "document_review" }] }]]));
  });

  it.each([["listing", "/api/v1/bi/applications"], ["detail", `/api/v1/bi/applications/${APP}`]])("maps document_review to document_review in the %s", async (_n, url) => {
    const r = await request(app()).get(url);
    expect(r.status).toBe(200);
    const sql = sqlText(callsMatching(poolQuery, "FROM bi_applications a")[0]![0]).replace(/\s+/g, " ");
    expect(sql).toContain("WHEN a.status = 'document_review' THEN 'document_review'");
    expect(sql).not.toContain("WHEN a.status = 'document_review' THEN 'under_review'");
  });
});
