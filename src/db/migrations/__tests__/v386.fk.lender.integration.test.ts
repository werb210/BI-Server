// BI_SERVER_BLOCK_v386_DROP_LEGACY_FK_AND_INTEGRATION_TEST_v1
//
// Real-DB integration test for the bi_applications.created_by_lender_user_id
// foreign key. Complements v385.fk.realign.test.ts (text-grep only — passes
// while the production bug is alive).
//
// Runs only when DATABASE_URL is set. Without it the suite skips cleanly so
// local runs without Postgres stay green. The Test #1/#2/#3 Suite env
// harness provides DATABASE_URL and applies migrations, so CI exercises it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";

const haveDb = !!process.env.DATABASE_URL;
const d = haveDb ? describe : describe.skip;

d("v386 — lender FK live-DB integration", () => {
  let pool: Pool;
  const lenderId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const appId = crypto.randomUUID();
  const phone = `+1587${Math.floor(1000000 + Math.random() * 8999999)}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `INSERT INTO bi_lenders (id, company_name, contact_phone_e164, is_active)
       VALUES ($1, 'v386 test lender', $2, TRUE)`,
      [lenderId, phone],
    );
    await pool.query(
      `INSERT INTO bi_lender_login_contacts
         (id, lender_id, full_name, email, phone_e164, is_active)
       VALUES ($1, $2, 'v386 test contact', $3, $4, TRUE)`,
      [contactId, lenderId, `v386-${contactId.slice(0, 8)}@test.local`, phone],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM bi_applications WHERE id = $1", [appId]).catch(() => {});
    await pool.query("DELETE FROM bi_lender_login_contacts WHERE id = $1", [contactId]).catch(() => {});
    await pool.query("DELETE FROM bi_lenders WHERE id = $1", [lenderId]).catch(() => {});
    await pool.end();
  });

  it("schema: exactly one FK on bi_applications.created_by_lender_user_id, targeting bi_lender_login_contacts", async () => {
    const r = await pool.query<{ conname: string; referenced_table: string }>(`
      SELECT con.conname, cl2.relname AS referenced_table
        FROM pg_constraint con
        JOIN pg_class cl1 ON cl1.oid = con.conrelid
        JOIN pg_class cl2 ON cl2.oid = con.confrelid
        JOIN pg_attribute a ON a.attnum = ANY(con.conkey) AND a.attrelid = con.conrelid
       WHERE con.contype = 'f'
         AND cl1.relname = 'bi_applications'
         AND a.attname = 'created_by_lender_user_id'`);
    expect(r.rows.map((x) => x.referenced_table).sort()).toEqual(["bi_lender_login_contacts"]);
    expect(r.rows.find((x) => x.conname === "fk_bi_apps_lender_user")).toBeUndefined();
  });

  it("behavior: INSERT with created_by_lender_user_id from bi_lender_login_contacts succeeds (no FK violation)", async () => {
    const result = await pool.query(
      `INSERT INTO bi_applications
         (id, public_id, status, source, source_type, created_by_actor,
          created_by_lender_id, created_by_lender_user_id, lender_id,
          guarantor_name, guarantor_email, business_name, country,
          loan_amount, pgi_limit, score_at)
       VALUES ($1, $2, 'ready_for_submission', 'lender', 'lender', 'lender',
               $3, $4, $3,
               'v386 G', 'v386g@test.local', 'v386 Co', 'CA',
               500000, 400000, NOW())
       RETURNING id`,
      [appId, `V386${appId.slice(0, 4).toUpperCase()}`, lenderId, contactId],
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].id).toBe(appId);
  });
});
