// BI_SERVER_US_PGI_LIMIT_CAP_v1 - a United States application may insure more than the Canadian $1,000,000. Real database.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import router from "../../routes/biPublicApplicationRoutes";

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("guarantee ceiling follows the country", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);
  const made: string[] = [];
  const body = (over: Record<string, unknown>) => ({
    country: "US", naics_code: "332710", formation_date: "2015-03-01",
    loan_amount: 2_000_000, pgi_limit: 1_800_000, annual_revenue: 6_500_000, ebitda: 900_000,
    total_debt: 2_400_000, monthly_debt_service: 32_000, collateral_value: 1_200_000, enterprise_value: 5_000_000,
    ...over,
  });

  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(async () => {
    if (made.length) await pool.query(`DELETE FROM bi_applications WHERE public_id = ANY($1)`, [made]);
    await pool.end();
  });

  it("scores a US application asking for a $1,800,000 guarantee", async () => {
    const r = await request(app).post("/api/v1/applications/score").send(body({}));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    const id = r.body.public_id ?? r.body.application?.public_id ?? r.body.id;
    if (id) made.push(String(id));
    const row = await pool.query(`SELECT pgi_limit::float8 AS pgi_limit, country FROM bi_applications ORDER BY created_at DESC LIMIT 1`);
    expect(row.rows[0]).toMatchObject({ pgi_limit: 1_800_000, country: "US" });
  });

  it("the database still refuses a Canadian guarantee above $1,000,000 and a US one above $5,000,000", async () => {
    const last = await pool.query(`SELECT id FROM bi_applications WHERE country = 'US' ORDER BY created_at DESC LIMIT 1`);
    const id = last.rows[0].id;
    await expect(pool.query(`UPDATE bi_applications SET pgi_limit = 5000001 WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`UPDATE bi_applications SET country = 'CA' WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
  });
});
