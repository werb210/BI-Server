// BI_SERVER_v789 [63] lender upload: extension + magic-bytes allowlist, doc
// type allowlist, re-upload replaces (ON CONFLICT ... DO UPDATE); [51] no
// uploaded_at on bi_documents; demo applications are never forwarded.
// Covers both lender uploads: the JWT one in biLenderApplicationCreate and the
// API-key one in biLenderApiRoutes (reached via next("route") for API keys).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  put: vi.fn(),
  pgiUploadDocument: vi.fn(),
}));

vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => h.queryMock(...args) } }));
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: (...a: unknown[]) => h.put(...a) }) }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiSubmit: vi.fn(),
  pgiScore: vi.fn(),
  pgiUploadDocument: (...a: unknown[]) => h.pgiUploadDocument(...a),
}));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: vi.fn(async () => undefined) }));

import biLenderApplicationCreate from "../biLenderApplicationCreate";
import biLenderApiRoutes from "../biLenderApiRoutes";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const LENDER_ID = "11111111-1111-4111-8111-111111111111";
const APP_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_KEY = "bk_live_aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(biLenderApplicationCreate);
  app.use("/api/v1", biLenderApiRoutes);
  return app;
}
const jwtAuth = () => `Bearer ${signBiToken({ kind: "lender", id: LENDER_ID }, "1h", process.env.JWT_SECRET as string)}`;
const keyAuth = () => `Bearer ${LIVE_KEY}`;

let docs: Map<string, { id: string; filename: string }>;
let pgiAppId: string | null;

beforeEach(() => {
  resetLenderActiveCache();
  docs = new Map();
  pgiAppId = "PGI-1";
  h.put.mockReset();
  h.put.mockImplementation(async (a: { filename: string }) => ({ blobName: `b/${a.filename}`, url: `https://blob/${a.filename}`, hash: "h", sizeBytes: 10 }));
  h.pgiUploadDocument.mockReset();
  h.pgiUploadDocument.mockResolvedValue({ document_id: "PGI-DOC-1" });
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN bi_lender_login_contacts/, { rows: [{ lender_active: true, contact_active: null }], rowCount: 1 }],
    ["FROM bi_lender_api_keys WHERE key_hash", (_s: string, p: unknown[]) => (p[0] === sha(LIVE_KEY) ? { rows: [{ lender_id: LENDER_ID, key_prefix: "bk_live_" }], rowCount: 1 } : { rows: [], rowCount: 0 })],
    ["SELECT id, lender_id, created_by_lender_id FROM bi_applications", { rows: [{ id: APP_ID, lender_id: LENDER_ID, created_by_lender_id: LENDER_ID }], rowCount: 1 }],
    ["SELECT id, status FROM bi_applications", { rows: [{ id: APP_ID, status: "submitted" }], rowCount: 1 }],
    ["SELECT pgi_application_id, is_demo FROM bi_applications", () => ({ rows: [{ pgi_application_id: pgiAppId, is_demo: false }], rowCount: 1 })],
    // A faithful stand-in for the partial unique index + ON CONFLICT DO UPDATE.
    ["INSERT INTO bi_documents", (sql: string, p: unknown[]) => {
      const key = `${p[0]}|${p[1]}`;
      const existing = docs.get(key);
      if (existing && /ON CONFLICT \(application_id, doc_type\) WHERE purged_at IS NULL\s+DO UPDATE/.test(sql)) {
        existing.filename = String(p[2]);
        return { rows: [{ id: existing.id }], rowCount: 1 };
      }
      if (existing) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      const row = { id: crypto.randomUUID(), filename: String(p[2]) };
      docs.set(key, row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }],
  ]));
});

for (const [label, auth] of [["JWT upload (biLenderApplicationCreate)", jwtAuth], ["API-key upload (biLenderApiRoutes)", keyAuth]] as const) {
  describe(label, () => {
    const url = "/api/v1/lender/applications/CODE1/documents";

    it("accepts an allowed type whose bytes match", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(200);
      expect(r.body.documents).toHaveLength(1);
      expect(h.pgiUploadDocument).toHaveBeenCalledTimes(1);
    });

    it("bad extension -> 400, nothing stored", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", Buffer.from("MZ\x90\x00"), { filename: "evil.exe", contentType: "application/pdf" });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: "invalid_file_type", reason: "extension_not_allowed" });
      expect(h.put).not.toHaveBeenCalled();
    });

    it("allowed extension but content mismatch -> 400, nothing stored", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", PNG, { filename: "loan.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ error: "invalid_file_type", reason: "content_mismatch" });
      expect(h.put).not.toHaveBeenCalled();
    });

    it("bad doc type -> 400", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "other").attach("files", PDF, { filename: "x.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid_doc_type");
      expect(h.put).not.toHaveBeenCalled();
    });

    it("missing doc type -> 400 (no silent 'other')", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth()).attach("files", PDF, { filename: "x.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid_doc_type");
    });

    it("one bad file in a batch rejects the whole batch before storing", async () => {
      const r = await request(buildApp()).post(url).set("Authorization", auth())
        .field("doc_types", "loan_agreement").field("doc_types", "balance_sheet")
        .attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" })
        .attach("files", PNG, { filename: "bs.xlsx", contentType: "application/vnd.ms-excel" });
      expect(r.status).toBe(400);
      expect(r.body.file_index).toBe(1);
      expect(h.put).not.toHaveBeenCalled();
    });

    it("re-upload of the same doc type replaces the earlier upload", async () => {
      const app = buildApp();
      const a = await request(app).post(url).set("Authorization", auth()).field("doc_types", "profit_loss").attach("files", PDF, { filename: "pl-v1.pdf", contentType: "application/pdf" });
      const b = await request(app).post(url).set("Authorization", auth()).field("doc_types", "profit_loss").attach("files", PDF, { filename: "pl-v2.pdf", contentType: "application/pdf" });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(docs.size).toBe(1);
      expect(b.body.documents[0].id).toBe(a.body.documents[0].id);
      expect([...docs.values()][0].filename).toBe("pl-v2.pdf");
      const insert = String(callsMatching(h.queryMock, "INSERT INTO bi_documents")[0][0]);
      expect(insert).not.toMatch(/uploaded_at/); // [51] bi_documents has no uploaded_at
      expect(insert).toMatch(/created_at = NOW\(\)/);
      expect(insert).toMatch(/pgi_document_id = NULL/);
    });

    it("a demo application's documents are never forwarded to the carrier", async () => {
      pgiAppId = "DEMO_CODE1";
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(200);
      expect(h.pgiUploadDocument).not.toHaveBeenCalled();
    });

    it("a carrier forward failure is non-fatal and its text is not returned", async () => {
      h.pgiUploadDocument.mockRejectedValue(new Error("PGI doc upload failed secret-body"));
      const r = await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain("secret-body");
      expect(callsMatching(h.queryMock, "UPDATE bi_documents SET pgi_document_id")).toHaveLength(0);
    });

    it("a forward success records pgi_document_id", async () => {
      await request(buildApp()).post(url).set("Authorization", auth()).field("doc_types", "loan_agreement").attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" });
      const upd = callsMatching(h.queryMock, "UPDATE bi_documents SET pgi_document_id")[0] as [string, unknown[]];
      expect(upd[1][0]).toBe("PGI-DOC-1");
    });
  });
}

describe("JWT upload ownership", () => {
  it("another lender's application answers 403", async () => {
    const other = signBiToken({ kind: "lender", id: "44444444-4444-4444-8444-444444444444" }, "1h", process.env.JWT_SECRET as string);
    const r = await request(buildApp()).post("/api/v1/lender/applications/CODE1/documents").set("Authorization", `Bearer ${other}`).field("doc_types", "loan_agreement").attach("files", PDF, { filename: "loan.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(403);
    expect(h.put).not.toHaveBeenCalled();
  });
});
