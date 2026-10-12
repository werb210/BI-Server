// BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3
// String-shape assertions covering every code/schema fix in v262.
// No DB required.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { vi } from "vitest";

const notesQueryMock = vi.fn();
vi.mock("../../db", () => ({
  pool: {
    query: (...args: unknown[]) => notesQueryMock(...args),
    connect: async () => ({ query: (...args: unknown[]) => notesQueryMock(...args), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));
// A silent real pino logger, so pino-http (the real app's httpLogger) can wrap it.
vi.mock("../../platform/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});
import { requireAuth } from "../../platform/auth";
import biNotesRoutes from "../biNotesRoutes";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

// BI_SERVER_v789 - lender portal blocks below are behaviour tests (they run the
// real biLenderApplicationCreate router against the mocked db).
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: async (a: { filename: string }) => ({ blobName: `b/${a.filename}`, url: `https://blob/${a.filename}`, hash: "h", sizeBytes: 8 }) }) }));
vi.mock("../../services/lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: async () => ({ pgi_application_id: null, pgi_status: null, pgi_error: null }) }));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: async () => undefined }));
import biLenderApplicationCreate from "../biLenderApplicationCreate";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";
import { callsMatching } from "../../__tests__/helpers/answerBySql";
import { ALLOWED_ORIGIN, fromBrowser, realApp } from "../../__tests__/helpers/realApp";

const V789_LENDER = "11111111-1111-4111-8111-111111111111";
function lenderPortalApp() {
  const a = express();
  a.use(express.json());
  a.use(biLenderApplicationCreate);
  return a;
}
const lenderPortalAuth = (id = V789_LENDER) => `Bearer ${signBiToken({ kind: "lender", id }, "1h", process.env.JWT_SECRET as string)}`;
function lenderPortalDb() {
  resetLenderActiveCache();
  notesQueryMock.mockReset();
  notesQueryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN/, { rows: [{ lender_active: true, contact_active: null }] }],
    ["INSERT INTO bi_applications", { rows: [{ id: "app-1", application_code: "C1" }] }],
    ["SELECT id, lender_id, created_by_lender_id FROM bi_applications", { rows: [{ id: "app-1", lender_id: V789_LENDER, created_by_lender_id: V789_LENDER }] }],
    ["INSERT INTO bi_documents", { rows: [{ id: "doc-1" }] }],
  ]));
}
const lenderPortalBody = {
  company_name: "Co",
  guarantor: { name: "G", phone: "+15875550100" },
  business: { country: "CA", province: "AB", naics: "236220", start_date: "2022-05-03" },
  loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Commercial Mortgage" },
};

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readMigration = (name: string) =>
  readFileSync(path.join(REPO_ROOT, "src/db/migrations", name), "utf8");

describe("BI_SERVER_BLOCK_v262 - migration", () => {
  const sql = readMigration("2026_05_19_carrier_path_e2e_fix_v262.sql");
  it("adds lender_notes + company_name on bi_applications", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lender_notes/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS company_name/i);
  });
  it("extends bi_document_type with 7 slot keys, one statement each", () => {
    for (const v of ["pl_12mo","forecast","gov_id_primary","gov_id_secondary","annual_y1","annual_y2","annual_y3"]) {
      const re = new RegExp(
        `ALTER\\s+TYPE\\s+bi_document_type\\s+ADD\\s+VALUE\\s+IF\\s+NOT\\s+EXISTS\\s+'${v}';`,
        "i"
      );
      expect(sql, `missing ADD VALUE for ${v}`).toMatch(re);
    }
  });
});

// BI_SERVER_v789 [5]/[37] - behaviour test (was a server.ts source grep): the
// real app (src/server.ts) is requested with the db mocked.
describe("BI_SERVER_BLOCK_v262 - server.ts duplicate mount removed", () => {
  const PUBLIC_LOOKUP = "SELECT * FROM bi_applications WHERE public_id=$1";
  it("biPublicApplicationRoutes no longer shadows the staff GET /api/v1/bi/applications/:id", async () => {
    notesQueryMock.mockReset();
    notesQueryMock.mockImplementation(answerBySql([]));
    const app = await realApp();
    const staff = jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string);
    const id = "11111111-1111-4111-8111-111111111111";
    await fromBrowser(app, "get", `/api/v1/bi/applications/${id}`).set("Authorization", `Bearer ${staff}`);
    // The staff detail route answered (it loads a.* by id) and the public
    // handler, which looks the id up as a public_id, never ran.
    expect(callsMatching(notesQueryMock, /SELECT a\.\*/)[0][1]).toContain(id);
    expect(callsMatching(notesQueryMock, PUBLIC_LOOKUP)).toHaveLength(0);
  });
  it("biPublicApplicationRoutes is still mounted at /api/v1 (public, with biCors)", async () => {
    notesQueryMock.mockReset();
    notesQueryMock.mockImplementation(answerBySql([[PUBLIC_LOOKUP, { rows: [{ id: "app-262", public_id: "PUBX262", status: "created" }] }]]));
    const app = await realApp();
    const r = await fromBrowser(app, "get", "/api/v1/applications/PUBX262");
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(r.body.application).toMatchObject({ public_id: "PUBX262" });
    expect(callsMatching(notesQueryMock, PUBLIC_LOOKUP)[0][1]).toEqual(["PUBX262"]);
  });
});

// BI_SERVER_v789 [5]/[37] - the biApplicationRoutes checks that were here (rich
// listing columns + filters, all_docs_accepted / effective_stage / company_name
// on the detail, the enriched {documents} list, both PATCH stage paths) are
// behaviour tests now: src/routes/__tests__/biApplicationRoutes.reads.v789.test.ts.
// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep): the
// notes GET answers with a `notes` array (never `items`), staff only.
describe("BI_SERVER_BLOCK_v262 - biNotesRoutes returns {notes}", () => {
  it("GET answers { notes: [...] } (also under data), not items", async () => {
    notesQueryMock.mockImplementation(answerBySql([
      ["FROM bi_applications", { rows: [{ "?column?": 1 }] }],
      ["FROM bi_application_notes", { rows: [{ id: "n1", body: "hi", author_name: "Ann", created_at: "2026-01-01" }] }],
    ]));
    const app = express();
    app.use(express.json());
    app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
    const token = jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string);
    const r = await request(app)
      .get("/api/v1/bi/applications/11111111-1111-4111-8111-111111111111/notes")
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.notes).toEqual([{ id: "n1", body: "hi", author_name: "Ann", created_at: "2026-01-01" }]);
    expect(r.body.data.notes).toEqual(r.body.notes);
    expect(r.body.items).toBeUndefined();
  });
});

describe("BI_SERVER_BLOCK_v262 - biLenderApplicationCreate", () => {
  it("application INSERT writes source_type='lender'", async () => {
    lenderPortalDb();
    const r = await request(lenderPortalApp()).post("/api/v1/lender/applications").set("Authorization", lenderPortalAuth()).send(lenderPortalBody);
    expect(r.status).toBe(201);
    const [sql] = callsMatching(notesQueryMock, "INSERT INTO bi_applications")[0] as [string];
    expect(sql).toMatch(/\(entity_type, source, source_type,/);
    expect(sql).toMatch(/VALUES \('applicant',\s*'lender',\s*'lender'/); // BI_UNQUARANTINE_CARRIER_E2E_v1 - status is no longer inserted
  });

  it("POST /api/v1/lender/applications/:code/documents stores the file and writes bi_documents as 'lender'", async () => {
    lenderPortalDb();
    const r = await request(lenderPortalApp()).post("/api/v1/lender/applications/C1/documents").set("Authorization", lenderPortalAuth())
      .field("doc_types", "loan_agreement").attach("files", Buffer.from("%PDF-1.4\n"), { filename: "loan.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(200);
    expect(r.body.documents).toEqual([{ id: "doc-1", doc_type: "loan_agreement", filename: "loan.pdf" }]);
    const [sql, params] = callsMatching(notesQueryMock, "INSERT INTO bi_documents")[0] as [string, unknown[]];
    expect(sql).toMatch(/'lender'/);
    expect(params[0]).toBe("app-1");
  });

  it("docs upload verifies lender ownership", async () => {
    lenderPortalDb();
    const r = await request(lenderPortalApp()).post("/api/v1/lender/applications/C1/documents").set("Authorization", lenderPortalAuth("22222222-2222-4222-8222-222222222222"))
      .field("doc_types", "loan_agreement").attach("files", Buffer.from("%PDF-1.4\n"), { filename: "loan.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(403);
    expect(callsMatching(notesQueryMock, "INSERT INTO bi_documents")).toHaveLength(0);
  });
});
