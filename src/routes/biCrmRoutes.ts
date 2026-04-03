import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

/* =========================
   CONTACTS
========================= */
router.get("/crm/contacts", async (_req, res) => {
  const result = await pool.query(`
    SELECT id, full_name, email, phone_e164
    FROM bi_contacts
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);
});

/* =========================
   REFERRERS
========================= */
router.get("/crm/referrers", async (_req, res) => {
  const result = await pool.query(`
    SELECT id, full_name, company_name, agreement_status
    FROM bi_referrers
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);
});

/* =========================
   LENDERS
========================= */
router.get("/crm/lenders", async (_req, res) => {
  const result = await pool.query(`
    SELECT id, rep_full_name, company_name
    FROM bi_lenders
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);
});

export default router;
