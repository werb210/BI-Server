// BI_SERVER_v789 [5]/[37] - behaviour tests that replace the source-text checks
// of worker-C files that lived inside shared test files:
//   - biCarrierSubmission.v559 "routes are staff-only" (biApplicationDetailRoutes)
//   - bfDocumentFile.v4 "staff view, download and the carrier submission all use it"
//     (biDocumentRoutes, biPgiSubmissionService)
//   - biEmailLinkClicks.v11 webhook checks (biSendgridWebhookRoutes)
//   - referralFromBf.v1 "notifies BF at policy bind" (pgiWebhookRoutes)
//   - notifyBiClient.v588 "every applicant notice goes through it" for
//     biDocumentRoutes (biJobs is covered by biJobs.v789 / cronColumnFix.v361)
//   (legacySunsetAndStubGuard.v362 "STUB default is env-aware" lives in
//   src/services/__tests__/pgiAdapter.timeouts.v789.test.ts)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";

const { WEBHOOK_SECRET } = vi.hoisted(() => ({ WEBHOOK_SECRET: String(process.env.JWT_SECRET) }));
const poolQuery = vi.fn();
const clientQuery = vi.fn();
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => poolQuery(...a),
    connect: async () => ({ query: (...a: unknown[]) => clientQuery(...a), release: () => undefined }),
  },
}));
vi.mock("../platform/env", async () => {
  const actual = await vi.importActual<typeof import("../platform/env")>("../platform/env");
  return { ...actual, env: { ...actual.env, PGI_WEBHOOK_SECRET: WEBHOOK_SECRET } };
});
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../platform/auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/ocrRunner", () => ({ runOcrForDocument: vi.fn() }));
vi.mock("../services/ocrService", () => ({ extractText: vi.fn() }));
vi.mock("../services/push/biPushSender", () => ({ notifyBiApplicant: vi.fn(async () => ({ sent: 0, removed: 0 })) }));
vi.mock("../services/pgiOnApprovedHook", () => ({ onApplicationApproved: vi.fn(async () => undefined) }));
const notifyBfReferralConversion = vi.fn(async () => undefined);
vi.mock("../services/notifyBfReferralConversion", () => ({ notifyBfReferralConversion: (...a: unknown[]) => (notifyBfReferralConversion as any)(...a) }));
const fetchBfDocumentFile = vi.fn(async (id: string) => ({ buffer: Buffer.from(`bf:${id}`), contentType: "application/pdf" }));
vi.mock("../services/bfDocumentFile", () => ({ fetchBfDocumentFile: (id: string) => fetchBfDocumentFile(id) }));
const notifyBiClient = vi.fn(async () => ({ channel: "push" }));
vi.mock("../services/notifyBiClient", () => ({ notifyBiClient: (...a: unknown[]) => (notifyBiClient as any)(...a) }));
const carrierOptionsFor = vi.fn(async () => []);
const sendToCarrier = vi.fn(async () => ({ ok: true }));
vi.mock("../services/biCarrierSubmission", () => ({ carrierOptionsFor: (...a: unknown[]) => (carrierOptionsFor as any)(...a), sendToCarrier: (...a: unknown[]) => (sendToCarrier as any)(...a) }));
const pgiUploadDocument = vi.fn(async (a: { docType: string }) => ({ document_id: `PGI-${a.docType}`, doc_type: a.docType, received_at: "now" }));
vi.mock("../services/pgiAdapter", async () => {
  const actual = await vi.importActual<typeof import("../services/pgiAdapter")>("../services/pgiAdapter");
  return { ...actual, pgiUploadDocument: (a: { docType: string }) => pgiUploadDocument(a) };
});

import detailRoutes from "../routes/biApplicationDetailRoutes";
import docRoutes from "../routes/biDocumentRoutes";
import webhookRoutes from "../routes/pgiWebhookRoutes";
import sendgridRoutes from "../routes/biSendgridWebhookRoutes";
import { forwardAcceptedDocsToCarrier } from "../services/biPgiSubmissionService";
import { answerBySql, callsMatching } from "./helpers/answerBySql";
import { createSendgridSigner } from "./helpers/sendgridSign";

const APP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PRODUCT = "12121212-1212-4212-8212-121212121212";

beforeEach(() => {
  poolQuery.mockReset().mockImplementation(answerBySql([], { rows: [], rowCount: 1 }));
  clientQuery.mockReset().mockImplementation(answerBySql([], { rows: [], rowCount: 1 }));
  for (const m of [notifyBfReferralConversion, fetchBfDocumentFile, notifyBiClient, carrierOptionsFor, sendToCarrier, pgiUploadDocument]) m.mockClear();
});

describe("v559 - carrier catalogue routes are staff-only", () => {
  function app(role: string) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).user = { role }; next(); });
    a.use("/api/v1/bi/applications", detailRoutes);
    return a;
  }
  it("refuses a non-staff role on both routes", async () => {
    expect((await request(app("lender")).get(`/api/v1/bi/applications/${APP}/carrier-options`)).status).toBe(403);
    expect((await request(app("lender")).post(`/api/v1/bi/applications/${APP}/products/${PRODUCT}/send-to-carrier`).send({ carrierProductId: PRODUCT })).status).toBe(403);
    expect(carrierOptionsFor).not.toHaveBeenCalled();
    expect(sendToCarrier).not.toHaveBeenCalled();
  });
  it("lets staff through", async () => {
    expect((await request(app("staff")).get(`/api/v1/bi/applications/${APP}/carrier-options`)).status).toBe(200);
    expect((await request(app("staff")).post(`/api/v1/bi/applications/${APP}/products/${PRODUCT}/send-to-carrier`).send({ carrierProductId: PRODUCT })).status).toBe(200);
  });
});

describe("v4 - documents copied from Boreal Financial are served and forwarded via fetchBfDocumentFile", () => {
  function app() {
    const a = express();
    a.use("/api/v1/bi/documents", docRoutes);
    return a;
  }
  beforeEach(() => {
    poolQuery.mockImplementation(answerBySql([
      ["mime_type, bf_document_id FROM bi_documents", { rows: [{ original_filename: "bf.pdf", storage_key: null, blob_name: null, mime_type: "application/pdf", bf_document_id: "BF-1" }] }],
    ], { rows: [], rowCount: 1 }));
  });
  it("staff view and download fetch the bytes from BF-Server", async () => {
    const view = await request(app()).get(`/api/v1/bi/documents/${DOC}`);
    expect(view.status).toBe(200);
    expect(view.headers["content-disposition"]).toContain("inline");
    const dl = await request(app()).get(`/api/v1/bi/documents/${DOC}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("attachment");
    expect(fetchBfDocumentFile).toHaveBeenCalledTimes(2);
    expect(fetchBfDocumentFile).toHaveBeenCalledWith("BF-1");
  });
  it("the carrier submission forwards a BF document's bytes", async () => {
    poolQuery.mockImplementation(answerBySql([
      [/pgi_document_id IS NULL/, { rows: [{ id: "d1", doc_type: "profit_loss", original_filename: "bf.pdf", mime_type: "application/pdf", storage_key: null, blob_name: null, bf_document_id: "BF-9" }] }],
    ], { rows: [], rowCount: 1 }));
    const out = await forwardAcceptedDocsToCarrier(APP, "PGI-1");
    expect(out.forwarded).toBe(1);
    expect(fetchBfDocumentFile).toHaveBeenCalledWith("BF-9");
  });
});

describe("v588 - the document-rejected notice goes through notifyBiClient", () => {
  it("rejecting a document notifies the client app-first (no direct SMS helper)", async () => {
    poolQuery.mockImplementation(answerBySql([
      [/FROM bi_documents d\s+JOIN bi_applications a/, { rows: [{ application_id: APP, doc_type: "profit_loss", contact_name: "Ann", contact_phone: "+15875550101" }] }],
    ], { rows: [], rowCount: 1 }));
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).user = { role: "staff", staffUserId: null }; next(); });
    a.use("/api/v1/bi/documents", docRoutes);
    const r = await request(a).post(`/api/v1/bi/documents/${DOC}/reject`).send({ reason: "blurry" });
    expect(r.status).toBe(200);
    expect(notifyBiClient).toHaveBeenCalledTimes(1);
    expect((notifyBiClient.mock.calls[0] as unknown[])[0]).toMatchObject({ applicationId: APP, kind: "DOCUMENT_REQUEST", smsTo: "+15875550101" });
  });
});

describe("referral from BF - BF is notified at policy bind", () => {
  it("policy.bound on an app with a referral code notifies BF with the premium", async () => {
    clientQuery.mockImplementation(answerBySql([
      ["INSERT INTO bi_webhook_log", { rows: [{ id: "l1" }], rowCount: 1 }],
      [/SET status = \$2/, { rows: [{ id: APP }], rowCount: 1 }],
    ], { rows: [], rowCount: 1 }));
    poolQuery.mockImplementation(answerBySql([
      ["SELECT referrer_code, annual_premium", { rows: [{ referrer_code: "BF-REF-1", annual_premium: "5000.00" }] }],
    ], { rows: [], rowCount: 1 }));
    const raw = JSON.stringify({ id: "evt-bind", event: "policy.bound", application_id: "PGI-1", policy_id: "POL-1" });
    const a = express();
    a.use(webhookRoutes);
    const r = await request(a).post("/api/v1/webhooks/pgi").set("Content-Type", "application/json")
      .set("X-PGI-Signature", crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")).send(raw);
    expect(r.status).toBe(200);
    expect(notifyBfReferralConversion).toHaveBeenCalledWith({ refCode: "BF-REF-1", externalId: APP, premium: 5000 });
  });
});

describe("v11 - SendGrid webhook link-click capture", () => {
  const signer = createSendgridSigner();
  afterEach(() => { delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY; });
  it("keeps the clicked URL on the ledger detail, records one click row, and always answers 200 with counts", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = signer.publicKeyBase64;
    const raw = JSON.stringify([{ email: "a@x.test", event: "click", url: "https://x.test/p", job_id: "j1", contact_id: "c1" }]);
    const a = express();
    a.use(sendgridRoutes);
    const r = await request(a).post("/api/v1/bi/webhooks/sendgrid").set("Content-Type", "application/json").set(signer.sign(raw)).send(raw);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, received: 1, suppressed: 0, logged: 1, linkClicks: 1 });
    const ledger = callsMatching(poolQuery, "INSERT INTO bi_marketing_send_events")[0]!;
    expect(JSON.parse(String((ledger[1] as unknown[])[4])).url).toBe("https://x.test/p");
    const click = callsMatching(poolQuery, "INSERT INTO bi_email_link_clicks (job_id, contact_id, email, url)");
    expect(click).toHaveLength(1);
    expect(click[0]![1]).toEqual(["j1", "c1", "a@x.test", "https://x.test/p"]);
  });
});
