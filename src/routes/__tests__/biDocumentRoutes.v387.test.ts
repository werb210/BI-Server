// BI_SERVER_BLOCK_v387_FILE_URL_ABSOLUTE_v1
// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep): /file-url
// answers an ABSOLUTE download URL built from the request host, so the
// portal's window.open does not resolve it against the static web app host.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../platform/auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn() }));
vi.mock("../../services/ocrService", () => ({ extractText: vi.fn() }));

import router from "../biDocumentRoutes";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const DOC = "99999999-9999-4999-8999-999999999999";
function app() {
  const a = express();
  a.use("/api/v1/bi/documents", router);
  return a;
}

describe("BI_SERVER_BLOCK_v387 - /file-url absolute URL", () => {
  beforeEach(() => {
    poolQuery.mockReset().mockImplementation(answerBySql([
      ["SELECT original_filename, mime_type FROM bi_documents", { rows: [{ original_filename: "la.pdf", mime_type: "application/pdf" }] }],
    ]));
  });

  it("builds the URL from the request host and forwarded proto", async () => {
    const r = await request(app()).get(`/api/v1/bi/documents/${DOC}/file-url`).set("Host", "bi.example.test").set("X-Forwarded-Proto", "https");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      url: `https://bi.example.test/api/v1/bi/documents/${DOC}/download`,
      filename: "la.pdf",
      mimeType: "application/pdf",
    });
  });

  it("a non-UUID id falls through (router also mounted at the bare /api/v1/bi prefix)", async () => {
    const r = await request(app()).get("/api/v1/bi/documents/carrier-health/file-url");
    expect(r.status).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});
