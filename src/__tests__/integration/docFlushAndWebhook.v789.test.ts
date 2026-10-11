// BI_SERVER_v789_DOC_FLUSH + BI_SERVER_v789_PGI_WEBHOOK_TX - against the REAL
// schema (bi_test, built by the migrations). The post-submit document flush
// used to ORDER BY bi_documents.uploaded_at, a column that does not exist, so
// the query failed every time and no document reached the carrier. Here the
// accept handler drives the whole path with only the carrier and the blob
// store faked; every accepted, non-purged, forwardable document must end up
// with a pgi_document_id. The webhook's forward-only guard and dedup row are
// checked against real Postgres too.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";

const pgiSubmitV2 = vi.fn();
const pgiUploadDocument = vi.fn();
vi.mock("../../services/pgiAdapter", async () => {
  const actual = await vi.importActual<typeof import("../../services/pgiAdapter")>("../../services/pgiAdapter");
  return { ...actual, pgiSubmitV2: (...a: unknown[]) => pgiSubmitV2(...a), pgiUploadDocument: (...a: unknown[]) => pgiUploadDocument(...a) };
});
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ get: async () => ({ buffer: Buffer.from("%PDF-1.4 v789"), contentType: "application/pdf" }) }),
}));
vi.mock("../../platform/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { role: "staff", staffUserId: null }; next(); },
}));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn(async () => undefined) }));
vi.mock("../../services/push/biPushSender", () => ({ notifyBiApplicant: vi.fn(async () => ({ sent: 0, removed: 0 })) }));
const { WEBHOOK_SECRET } = vi.hoisted(() => ({ WEBHOOK_SECRET: String(process.env.JWT_SECRET) }));
vi.mock("../../platform/env", async () => {
  const actual = await vi.importActual<typeof import("../../platform/env")>("../../platform/env");
  return { ...actual, env: { ...actual.env, PGI_WEBHOOK_SECRET: WEBHOOK_SECRET } };
});

import { pool } from "../../db";
import { resetDb, seedApplication, seedDocument } from "../../test-support/integrationDb";
import biDocumentRoutes from "../../routes/biDocumentRoutes";
import pgiWebhookRoutes from "../../routes/pgiWebhookRoutes";
import { forwardAcceptedDocsToCarrier } from "../../services/biPgiSubmissionService";

const haveDb = Boolean(process.env.DATABASE_URL);

function docApp() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi/documents", biDocumentRoutes);
  return a;
}
function postWebhook(evt: Record<string, unknown>) {
  const raw = JSON.stringify(evt);
  const a = express();
  a.use(pgiWebhookRoutes);
  return request(a)
    .post("/api/v1/webhooks/pgi")
    .set("Content-Type", "application/json")
    .set("X-PGI-Signature", crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"))
    .send(raw);
}

describe.skipIf(!haveDb)("v789 carrier path against the real schema", () => {
  beforeEach(async () => {
    await resetDb();
    pgiSubmitV2.mockReset().mockResolvedValue({ application_id: "PGI-INT-1", status: "received" });
    let n = 0;
    pgiUploadDocument.mockReset().mockImplementation(async (a: { docType: string }) => ({ document_id: `PGI-DOC-${a.docType}-${(n += 1)}`, doc_type: a.docType, received_at: new Date().toISOString() }));
  });
  afterAll(async () => {
    if (haveDb) await resetDb();
  });

  it("forwardAcceptedDocsToCarrier's query runs on the real bi_documents schema", async () => {
    const app = await seedApplication();
    const d = await seedDocument(app.id, { doc_type: "profit_loss" });
    const out = await forwardAcceptedDocsToCarrier(app.id, "PGI-X");
    expect(out).toEqual({ forwarded: 1, skipped: 0, failed: 0 });
    const r = await pool.query(`SELECT pgi_document_id, forwarded_to_carrier_at FROM bi_documents WHERE id = $1`, [d.id]);
    expect(r.rows[0].pgi_document_id).toMatch(/^PGI-DOC-profit_loss-/);
    expect(r.rows[0].forwarded_to_carrier_at).not.toBeNull();
  });

  it("accepting the last document submits the app and flushes every accepted document", async () => {
    const app = await seedApplication({ status: "document_review", stage: "documents_pending" });
    const accepted = await Promise.all(["profit_loss", "balance_sheet", "ar_aging", "ap_aging"].map((t) => seedDocument(app.id, { doc_type: t })));
    const purged = await seedDocument(app.id, { doc_type: "founder_cv", purged: true });
    const notForwardable = await seedDocument(app.id, { doc_type: "other" });
    const last = await seedDocument(app.id, { doc_type: "loan_agreement", review_status: "pending" });

    const res = await request(docApp()).post(`/api/v1/bi/documents/${last.id}/accept`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ autoSubmittedToPgi: true, pgiSubmitError: null, finalStatus: "submitted" });

    const appRow = await pool.query(`SELECT pgi_application_id, status, submission_locked FROM bi_applications WHERE id = $1`, [app.id]);
    expect(appRow.rows[0]).toMatchObject({ pgi_application_id: "PGI-INT-1", status: "submitted", submission_locked: true });

    const docs = await pool.query<{ id: string; pgi_document_id: string | null }>(`SELECT id, pgi_document_id FROM bi_documents WHERE application_id = $1`, [app.id]);
    const byId = new Map(docs.rows.map((r) => [r.id, r.pgi_document_id]));
    for (const d of [...accepted, last]) expect(byId.get(d.id)).toMatch(/^PGI-DOC-/);
    expect(byId.get(purged.id)).toBeNull();
    expect(byId.get(notForwardable.id)).toBeNull();
    expect(pgiUploadDocument).toHaveBeenCalledTimes(5);
    expect(pgiUploadDocument.mock.calls.every((c) => (c[0] as { pgiApplicationId: string }).pgiApplicationId === "PGI-INT-1")).toBe(true);
  });

  it("a carrier failure writes carrier_submission_failed to bi_events and releases the lock", async () => {
    pgiSubmitV2.mockRejectedValue(new Error("carrier down"));
    const app = await seedApplication();
    const last = await seedDocument(app.id, { doc_type: "loan_agreement", review_status: "pending" });
    const res = await request(docApp()).post(`/api/v1/bi/documents/${last.id}/accept`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.pgiSubmitError).toBe("PGI_SUBMIT_FAILED");
    const ev = await pool.query(`SELECT type, silo, payload FROM bi_events WHERE application_id = $1`, [app.id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]).toMatchObject({ type: "carrier_submission_failed", silo: "bi" });
    const row = await pool.query(`SELECT submission_locked FROM bi_applications WHERE id = $1`, [app.id]);
    expect(row.rows[0].submission_locked).toBe(false);
  });

  it("webhook: a late application.received leaves an approved application approved; the event is logged once", async () => {
    const app = await seedApplication({ status: "approved", stage: "approved", pgi_application_id: "PGI-WH-1" });
    const evt = { id: `evt-${app.id}`, event: "application.received", application_id: "PGI-WH-1" };
    const first = await postWebhook(evt);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    const row = await pool.query(`SELECT status, carrier_last_event FROM bi_applications WHERE id = $1`, [app.id]);
    expect(row.rows[0]).toMatchObject({ status: "approved", carrier_last_event: "application.received" });
    const again = await postWebhook(evt);
    expect(again.body).toEqual({ ok: true, deduped: true });
    const log = await pool.query(`SELECT COUNT(*)::int AS n FROM bi_webhook_log WHERE pgi_webhook_id = $1`, [evt.id]);
    expect(log.rows[0].n).toBe(1);
  });

  it("webhook: a forward move applies (submitted -> approved) and a no-id event dedups by body hash", async () => {
    const app = await seedApplication({ status: "submitted", stage: "under_review", pgi_application_id: "PGI-WH-2" });
    const evt = { event: "application.approved", application_id: "PGI-WH-2" };
    expect((await postWebhook(evt)).body).toEqual({ ok: true });
    const row = await pool.query(`SELECT status FROM bi_applications WHERE id = $1`, [app.id]);
    expect(row.rows[0].status).toBe("approved");
    expect((await postWebhook(evt)).body).toEqual({ ok: true, deduped: true });
    const log = await pool.query(`SELECT pgi_webhook_id FROM bi_webhook_log`);
    expect(log.rows.map((r) => r.pgi_webhook_id)).toEqual([`sha256:${crypto.createHash("sha256").update(JSON.stringify(evt)).digest("hex")}`]);
  });
});
