// BI_SERVER_BLOCK_v403 FK-safe bi_activity audit inserts.
// BI_SERVER_v789 [5]/[37] - behaviour test (was a source-text grep): the
// audit inserts the handlers actually issue FK-guard the actor id, so an id
// that is not a bi_users row can never fail the insert.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const poolQuery = vi.fn();
vi.mock("../db", () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }));
vi.mock("../platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../platform/auth", () => ({ requireAuth: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../services/ocrRunner", () => ({ runOcrForDocument: vi.fn() }));
vi.mock("../services/ocrService", () => ({ extractText: vi.fn() }));
vi.mock("../services/push/biPushSender", () => ({ notifyBiApplicant: vi.fn(async () => ({ sent: 0, removed: 0 })) }));

import detailRoutes from "../routes/biApplicationDetailRoutes";
import docRoutes from "../routes/biDocumentRoutes";
import { answerBySql, callsMatching, sqlText } from "../__tests__/helpers/answerBySql";

const APP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as any).user = { role: "staff", staffUserId: STAFF, id: STAFF }; next(); });
  a.use("/api/v1/bi/applications", detailRoutes);
  a.use("/api/v1/bi/documents", docRoutes);
  return a;
}
const activity = () => callsMatching(poolQuery, "INSERT INTO bi_activity").map((c) => sqlText(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
  poolQuery.mockReset().mockImplementation(answerBySql([
    [/SELECT d\.application_id, d\.doc_type, a\.source_type/, { rows: [{ application_id: APP, doc_type: "profit_loss", source_type: "referral" }], rowCount: 1 }],
    [/COUNT\(\*\) FILTER/, { rows: [{ pending: "0", accepted: "1", total: "1" }] }],
    [/SET status = 'ready_for_submission'/, { rows: [{ id: APP }], rowCount: 1 }],
    [/SET purged_at = NOW\(\)/, { rows: [{ id: DOC, application_id: APP, doc_type: "profit_loss" }] }],
  ], { rows: [], rowCount: 1 }));
});

describe("v403 FK-safe bi_activity audit inserts", () => {
  it("accept/reject staff inserts FK-guard the actor", async () => {
    await request(app()).post(`/api/v1/bi/applications/${APP}/documents/${DOC}/accept`).send({}).expect(200);
    await request(app()).post(`/api/v1/bi/applications/${APP}/documents/${DOC}/reject`).send({ reason: "blurry" }).expect(200);
    const staff = activity().filter((s) => s.includes("'staff'"));
    expect(staff.length).toBeGreaterThanOrEqual(2);
    for (const s of staff) expect(s).toContain("VALUES($1, 'staff', (SELECT id FROM bi_users WHERE id = $2),");
  });

  it("system inserts (stage change) FK-guard the actor", async () => {
    await request(app()).post(`/api/v1/bi/applications/${APP}/documents/${DOC}/accept`).send({}).expect(200);
    const system = activity().filter((s) => s.includes("'system'"));
    expect(system.length).toBeGreaterThanOrEqual(1);
    for (const s of system) expect(s).toContain("VALUES($1, 'system', (SELECT id FROM bi_users WHERE id = $2),");
  });

  it("delete audit insert uses the real columns and FK-guards the actor", async () => {
    const r = await request(app()).delete(`/api/v1/bi/documents/${DOC}`);
    expect(r.status).toBe(200);
    const del = activity();
    expect(del).toHaveLength(1);
    expect(del[0]).toContain("INSERT INTO bi_activity (application_id, actor_type, actor_user_id, event_type, summary, meta)");
    expect(del[0]).toContain("(SELECT id FROM bi_users WHERE id = $2), 'document_deleted', $3, $4::jsonb)");
  });
});
