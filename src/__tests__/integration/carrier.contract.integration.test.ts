// BI_SERVER_BLOCK_v391_CARRIER_CONTRACT_v1
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { describe, beforeAll, afterAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import biLenderApplicationCreate from "../../routes/biLenderApplicationCreate";
import biLenderApiRoutes from "../../routes/biLenderApiRoutes";

const haveDb = !!process.env.DATABASE_URL;
const ints = haveDb ? describe : describe.skip;
const JWT_SECRET = process.env.JWT_SECRET || "dev-missing-jwt-secret";
function makePool(): Pool { return new Pool({ connectionString: process.env.DATABASE_URL }); }
function randPhone(): string { const tail = String(Math.floor(1000 + Math.random() * 8999)); return `+1587555${tail}`.padEnd(12, "0").slice(0, 12); }
function randEmail(p = "itest"): string { return `${p}-${crypto.randomBytes(4).toString("hex")}@itest.local`; }
async function seedLenderWithLoginContact(pool: Pool) {
  const lenderId = crypto.randomUUID(); const contactId = crypto.randomUUID(); const phone = randPhone(); const email = randEmail("lender");
  await pool.query(`INSERT INTO bi_lenders (id, company_name, contact_phone_e164, contact_email, is_active) VALUES ($1,$2,$3,$4,TRUE)`, [lenderId, `itest lender ${lenderId.slice(0, 8)}`, phone, email]);
  await pool.query(`INSERT INTO bi_lender_login_contacts (id, lender_id, full_name, email, phone_e164, role, is_active) VALUES ($1,$2,$3,$4,$5,'admin',TRUE)`, [contactId, lenderId, "itest contact", email, phone]);
  return { lenderId, contactId, phone, email };
}
async function cleanupLender(pool: Pool, lenderId: string) { await pool.query(`DELETE FROM bi_applications WHERE created_by_lender_id = $1 OR lender_id = $1`, [lenderId]).catch(() => {}); await pool.query(`DELETE FROM bi_lenders WHERE id = $1`, [lenderId]).catch(() => {}); }
function deepMerge<T extends Record<string, any>>(a: T, b: Record<string, any>): T { const out: any = { ...a }; for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") out[k] = deepMerge(a[k], b[k]); else out[k] = b[k]; } return out; }
function validLenderBody(overrides: Record<string, any> = {}): Record<string, any> { const base = { company_name: "Itest Co", guarantor: { name: "Itest Guarantor", dob: "1980-01-01", email: "itest-g@itest.local", address: "125 Main St, Calgary, AB T2P 1A1", phone: "+15875550100", q_ca_id_type: "Driving Licence", q_ca_id_number: "AB-1234567" }, business: { country: "CA", province: "AB", address: "125 Main St, Calgary, AB T2P 1A1", naics: "236220", start_date: "2022-05-03" }, loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Other Secured Loan" }, financials: { revenue_last_year: 2000000, ebitda_last_year: 400000, total_debt: 300000, monthly_debt_service: 8000, collateral_value: 600000, enterprise_value: 1500000 }, declarations: { section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no" }, co_guarantors: [], lender_name: "Itest Lender" }; return deepMerge(base, overrides); }
function mintLenderJwt(lenderId: string, userId: string): string { return jwt.sign({ kind: "lender", id: lenderId, user_id: userId }, JWT_SECRET, { expiresIn: "1h" }); }
function buildApp() { const app = express(); app.use(express.json({ limit: "10mb" })); app.use(biLenderApplicationCreate); app.use("/api/v1", biLenderApiRoutes); return app; }
ints("CARRIER CONTRACT: lender doc forwarding (live DB, PGI stubbed)", () => {
  let pool: Pool; beforeAll(async () => { pool = makePool(); }); afterAll(async () => { await pool.end(); });
  it("lender doc upload FORWARDS to the carrier (forwarded_to_carrier_at + pgi_document_id set)", async () => { const { lenderId, phone } = await seedLenderWithLoginContact(pool); try { const otp = await request(buildApp()).post("/api/v1/lender/otp/verify").send({ phone, code: "000000" }); const token = otp.body.token as string; const create = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token}`).send(validLenderBody({ guarantor: { q_ca_id_type: "Passport", q_ca_id_number: "P-391" } })); expect(create.status).toBe(201); const appId = create.body.id as string; const appCode = create.body.application_code as string; expect(create.body.pgi_application_id).toMatch(/^STUB_APP_/); const up = await request(buildApp()).post(`/api/v1/lender/applications/${appCode}/documents`).set("Authorization", `Bearer ${token}`).field("doc_types", "loan_agreement").attach("files", Buffer.from("%PDF-1.4 carrier test\n%%EOF"), { filename: "loan_agreement.pdf", contentType: "application/pdf" }); expect(up.status).toBe(200); expect(up.body.ok).toBe(true); const doc = await pool.query<{ pgi_document_id: string | null; forwarded_to_carrier_at: string | null }>(`SELECT pgi_document_id, forwarded_to_carrier_at FROM bi_documents WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`, [appId]); expect(doc.rows[0].pgi_document_id).toMatch(/^STUB_DOC_/); expect(doc.rows[0].forwarded_to_carrier_at).not.toBeNull(); } finally { await cleanupLender(pool, lenderId); } });
  it("carrier payload carries the business legal name (q15) + top-level business_name", async () => { const { lenderId, phone } = await seedLenderWithLoginContact(pool); try { const otp = await request(buildApp()).post("/api/v1/lender/otp/verify").send({ phone, code: "000000" }); const token = otp.body.token as string; const create = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${token}`).send(validLenderBody({ company_name: "Acme Widgets Inc." })); expect(create.status).toBe(201); const row = await pool.query<{ carrier_submission_request: any }>(`SELECT carrier_submission_request FROM bi_applications WHERE id = $1`, [create.body.id]); const body = row.rows[0].carrier_submission_request; expect(body.form_data.q15_business_legal_name).toBe("Acme Widgets Inc."); expect(body.business_name).toBe("Acme Widgets Inc."); } finally { await cleanupLender(pool, lenderId); } });
  it("mintLenderJwt helper is wired (sanity)", () => { const t = mintLenderJwt("a", "b"); expect(typeof t).toBe("string"); });
});
