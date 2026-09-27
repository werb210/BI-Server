// BI_SERVER_BLOCK_v595_COMMISSIONS_BY_CURRENCY - real database.
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { pool } from "../../db";
import router from "../biCommissionRoutes";

const app = express();
app.use(express.json());
app.use("/c", router);

async function application(country: string | null): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO bi_applications (id, public_id, status, source, source_type, created_by_actor, business_name, country, created_at, updated_at)
     VALUES (gen_random_uuid(), gen_random_uuid()::text, 'created', 'public', 'public', 'system', $1, COALESCE($2, 'CA'), NOW(), NOW()) RETURNING id`,
    [`v595 ${country ?? "CA"}`, country],
  );
  return r.rows[0].id;
}

describe("GET /commissions/summary (real database)", () => {
  it("splits US policies into USD and the rest into CAD, and premium received makes it payable", async () => {
    const us = await application("US");
    const ca = await application("CA");
    const c1 = await pool.query<{ id: string }>(`INSERT INTO bi_commissions (application_id, annual_premium_amount, commission_amount, status) VALUES ($1, 2000, 100, 'estimated') RETURNING id`, [us]);
    await pool.query(`INSERT INTO bi_commissions (application_id, annual_premium_amount, commission_amount, status) VALUES ($1, 1000, 50, 'estimated')`, [ca]);

    let r = await request(app).get("/c/summary");
    expect(r.status).toBe(200);
    const body = r.body.data ?? r.body;
    expect(body.byStatus.estimated.USD.commission).toBeGreaterThanOrEqual(100);
    expect(body.byStatus.estimated.CAD.commission).toBeGreaterThanOrEqual(50);

    r = await request(app).post(`/c/${c1.rows[0].id}/premium-received`);
    expect(r.status).toBe(200);
    const row = await pool.query(`SELECT status::text AS status, premium_received_at IS NOT NULL AS received FROM bi_commissions WHERE id = $1`, [c1.rows[0].id]);
    expect(row.rows[0]).toEqual({ status: "payable", received: true });
  });
});
