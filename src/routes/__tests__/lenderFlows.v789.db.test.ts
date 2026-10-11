// BI_SERVER_v789 - lender create/upload against a real database: the
// re-upload replaces the live row (partial unique index), a failed carrier
// submit leaves carrier_received_at NULL and writes bi_events, the
// Idempotency-Key row is persisted in bi_idempotency_keys, and an inactive
// login contact is refused.
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/bi_test NODE_ENV=test npx vitest run <this file>
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

const h = vi.hoisted(() => ({ submitFails: false }));
vi.mock("../../services/pgiAdapter", async () => {
  const actual = await vi.importActual<any>("../../services/pgiAdapter");
  return {
    ...actual,
    pgiSubmit: async (...a: unknown[]) => {
      if (h.submitFails) throw new Error("PGI submit failed: 503");
      return actual.pgiSubmit(...a);
    },
  };
});
vi.mock("../../lib/storage", () => ({
  getStorage: () => ({ put: async (a: { filename: string }) => ({ blobName: `t/${crypto.randomUUID()}/${a.filename}`, url: `https://blob.test/${a.filename}`, hash: "h", sizeBytes: 12 }) }),
}));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: async () => undefined }));

const haveDb = !!process.env.DATABASE_URL;

describe.skipIf(!haveDb)("v789 lender flows (real database)", () => {
  let pool: any;
  let app: express.Express;
  let signBiToken: any;
  let resetLenderActiveCache: () => void;
  const lenderId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  const token = () => signBiToken({ kind: "lender", id: lenderId, user_id: contactId }, "1h", process.env.JWT_SECRET as string);
  const body = () => ({
    company_name: "Db Test Co",
    guarantor: { name: "G", dob: "1980-01-01", email: "g@itest.local", address: "125 Main St, Calgary, AB T2P 1A1", phone: "+15875550100", q_ca_id_type: "Passport", q_ca_id_number: "P-1" },
    business: { country: "CA", province: "AB", address: "125 Main St, Calgary, AB T2P 1A1", naics: "236220", start_date: "2022-05-03" },
    loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Other Secured Loan" },
    declarations: { section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no" },
  });

  beforeAll(async () => {
    ({ pool } = await import("../../db"));
    ({ signBiToken } = await import("../../platform/serviceTokens"));
    ({ resetLenderActiveCache } = await import("../../services/lenderActiveCache"));
    const create = (await import("../biLenderApplicationCreate")).default;
    const api = (await import("../biLenderApiRoutes")).default;
    app = express();
    app.use(express.json());
    app.use(create);
    app.use("/api/v1", api);
    await pool.query(`INSERT INTO bi_lenders (id, company_name, is_active) VALUES ($1, 'v789 db lender', TRUE)`, [lenderId]);
    await pool.query(`INSERT INTO bi_lender_login_contacts (id, lender_id, full_name, email, role, is_active) VALUES ($1, $2, 'c', $3, 'admin', TRUE)`, [contactId, lenderId, `v789-${lenderId.slice(0, 8)}@itest.local`]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM bi_idempotency_keys WHERE lender_id = $1`, [lenderId]);
    await pool.query(`DELETE FROM bi_events WHERE application_id IN (SELECT id FROM bi_applications WHERE lender_id = $1)`, [lenderId]);
    await pool.query(`DELETE FROM bi_applications WHERE lender_id = $1`, [lenderId]);
    await pool.query(`DELETE FROM bi_lender_login_contacts WHERE lender_id = $1`, [lenderId]);
    await pool.query(`DELETE FROM bi_lenders WHERE id = $1`, [lenderId]);
  });

  beforeEach(() => {
    h.submitFails = false;
    resetLenderActiveCache();
  });

  it("re-upload of the same doc type leaves one live row with the newer file", async () => {
    const c = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).send(body());
    expect(c.status).toBe(201);
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    for (const name of ["pl-1.pdf", "pl-2.pdf"]) {
      const up = await request(app).post(`/api/v1/lender/applications/${c.body.application_code}/documents`).set("Authorization", `Bearer ${token()}`).field("doc_types", "profit_loss").attach("files", pdf, { filename: name, contentType: "application/pdf" });
      expect(up.status).toBe(200);
    }
    const rows = await pool.query(`SELECT original_filename FROM bi_documents WHERE application_id = $1 AND doc_type = 'profit_loss' AND purged_at IS NULL`, [c.body.id]);
    expect(rows.rows).toEqual([{ original_filename: "pl-2.pdf" }]);
  });

  it("a failed carrier submit leaves carrier_received_at NULL and writes carrier_submission_failed", async () => {
    h.submitFails = true;
    const c = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).send(body());
    expect(c.status).toBe(201);
    expect(c.body.pgi_error).toBe("carrier_submit_failed");
    const row = await pool.query(`SELECT carrier_received_at, carrier_last_event FROM bi_applications WHERE id = $1`, [c.body.id]);
    expect(row.rows[0]).toEqual({ carrier_received_at: null, carrier_last_event: "submit_failed" });
    const ev = await pool.query(`SELECT type, silo, payload FROM bi_events WHERE application_id = $1`, [c.body.id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]).toMatchObject({ type: "carrier_submission_failed", silo: "bi" });
  });

  it("a successful carrier submit sets carrier_received_at", async () => {
    const c = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).send(body());
    const row = await pool.query(`SELECT carrier_received_at FROM bi_applications WHERE id = $1`, [c.body.id]);
    expect(row.rows[0].carrier_received_at).not.toBeNull();
  });

  it("Idempotency-Key: second POST replays, one application row", async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const a = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).set("Idempotency-Key", key).send(body());
    const b = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).set("Idempotency-Key", key).send(body());
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM bi_applications WHERE id = $1`, [a.body.id]);
    expect(n.rows[0].n).toBe(1);
    const stored = await pool.query(`SELECT response FROM bi_idempotency_keys WHERE lender_id = $1 AND idem_key = $2`, [lenderId, key]);
    expect(stored.rows[0].response.status).toBe(201);
  });

  it("an inactive login contact is refused", async () => {
    await pool.query(`UPDATE bi_lender_login_contacts SET is_active = FALSE WHERE id = $1`, [contactId]);
    try {
      const r = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token()}`).send(body());
      expect(r.status).toBe(403);
    } finally {
      await pool.query(`UPDATE bi_lender_login_contacts SET is_active = TRUE WHERE id = $1`, [contactId]);
    }
  });
});
