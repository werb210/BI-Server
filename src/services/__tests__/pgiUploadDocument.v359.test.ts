// BI_SERVER_BLOCK_v359_PGI_DOC_FORWARDING_v1
// BI_SERVER_v789 [5]/[37] - behaviour tests (these used to grep the source of
// pgiAdapter.ts and biDocumentRoutes.ts). The adapter is exercised in stub mode
// and in live mode against a fake fetch; the staff accept-all backfill is the
// shared post-submit flush (flushAcceptedDocsAfterSubmit ->
// forwardAcceptedDocsToCarrier) that both accept handlers call, driven here
// with the database mocked by SQL content. The accept handlers themselves are
// covered in src/routes/__tests__/biAcceptAutoSubmit.v789.test.ts.
//
// BI_SERVER_v789 - the lender upload forwarding checks (forwards when
// pgi_application_id is set, records pgi_document_id + forwarded_to_carrier_at,
// a forward failure is non-fatal) are behaviour tests now, for both lender
// uploads: src/routes/__tests__/lenderUpload.v789.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const poolQuery = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ get: async (key: string) => (key === "missing" ? null : { buffer: Buffer.from(`bytes:${key}`), contentType: "application/pdf" }) }),
}));

import { answerBySql, callsMatching, sqlText } from "../../__tests__/helpers/answerBySql";

const ENV_KEYS = ["USE_PGI_STUB", "PGI_BASE_URL", "PGI_API_KEY", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

async function loadAdapter(live: boolean) {
  process.env.USE_PGI_STUB = live ? "false" : "true";
  process.env.PGI_BASE_URL = "https://carrier.test";
  process.env.PGI_API_KEY = "pk_test_v359";
  vi.resetModules();
  return import("../pgiAdapter");
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  poolQuery.mockReset();
});
afterEach(() => {
  global.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("v359 - pgiUploadDocument", () => {
  it("STUB mode returns a deterministic stub response without calling the carrier", async () => {
    const { pgiUploadDocument } = await loadAdapter(false);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const r = await pgiUploadDocument({ pgiApplicationId: "P1", docType: "ar_aging", filename: "a.pdf", buffer: Buffer.from("x"), mimeType: "application/pdf" });
    expect(r.document_id).toMatch(/^STUB_DOC_ar_aging_/);
    expect(r.doc_type).toBe("ar_aging");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts multipart (doc_type + file) to /api/v2/applications/{id}/documents/", async () => {
    const { pgiUploadDocument } = await loadAdapter(true);
    let seen: { url: string; init: RequestInit } | null = null;
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ document_id: "PGI-D1", doc_type: "profit_loss", received_at: "now" }), { status: 201 });
    }) as any;
    const r = await pgiUploadDocument({ pgiApplicationId: "APP 1", docType: "profit_loss", filename: "pl.pdf", buffer: Buffer.from("PDF"), mimeType: "application/pdf" });
    expect(r.document_id).toBe("PGI-D1");
    expect(seen!.url).toBe("https://carrier.test/api/v2/applications/APP%201/documents/");
    expect(seen!.init.method).toBe("POST");
    const fd = seen!.init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("doc_type")).toBe("profit_loss");
    const file = fd.get("file") as File;
    expect(file.name).toBe("pl.pdf");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("PDF");
    // FormData sets its own multipart boundary; no JSON content type.
    expect(JSON.stringify(seen!.init.headers)).not.toContain("Content-Type");
  });
});

describe("v359 - staff accept-all backfills any pending forwards", () => {
  it("forwards every accepted, unforwarded, forwardable document once the carrier id exists", async () => {
    await loadAdapter(true);
    const uploaded: string[] = [];
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const t = String((init?.body as FormData).get("doc_type"));
      uploaded.push(t);
      return new Response(JSON.stringify({ document_id: `PGI-${t}`, doc_type: t, received_at: "now" }), { status: 201 });
    }) as any;
    poolQuery.mockImplementation(answerBySql([
      [/review_status = 'accepted'\s+AND pgi_document_id IS NULL/, { rows: [
        { id: "d1", doc_type: "loan_agreement", original_filename: "la.pdf", mime_type: "application/pdf", storage_key: "k1", blob_name: "k1", bf_document_id: null },
        { id: "d2", doc_type: "other", original_filename: "x.pdf", mime_type: "application/pdf", storage_key: "k2", blob_name: "k2", bf_document_id: null },
        { id: "d3", doc_type: "balance_sheet", original_filename: "bs.pdf", mime_type: "application/pdf", storage_key: "missing", blob_name: null, bf_document_id: null },
      ] }],
    ], { rows: [], rowCount: 1 }));
    const { flushAcceptedDocsAfterSubmit } = await import("../biPgiSubmissionService");
    const out = await flushAcceptedDocsAfterSubmit("app-1", "PGI-APP-1");
    expect(out).toEqual({ forwarded: 1, skipped: 1, failed: 1 }); // a missing blob is non-fatal
    expect(uploaded).toEqual(["loan_agreement"]);
    const sql = sqlText(callsMatching(poolQuery, /pgi_document_id IS NULL/)[0]![0]);
    expect(sql).toMatch(/ORDER BY created_at/);
    expect(sql).not.toContain("uploaded_at");
    const upd = callsMatching(poolQuery, /SET pgi_document_id = \$1/);
    expect(upd).toHaveLength(1);
    expect(upd[0]![1]).toEqual(["PGI-loan_agreement", "d1"]);
  });

  it("does nothing (and never throws) before a carrier id exists or when the query fails", async () => {
    await loadAdapter(true);
    const { flushAcceptedDocsAfterSubmit } = await import("../biPgiSubmissionService");
    expect(await flushAcceptedDocsAfterSubmit("app-1", "")).toEqual({ forwarded: 0, skipped: 0, failed: 0 });
    expect(poolQuery).not.toHaveBeenCalled();
    poolQuery.mockRejectedValue(new Error("db down"));
    expect(await flushAcceptedDocsAfterSubmit("app-1", "PGI-1")).toEqual({ forwarded: 0, skipped: 0, failed: 0 });
  });
});
