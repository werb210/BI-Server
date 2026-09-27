// BI_SERVER_BLOCK_v586_BF_HANDOFF_DATES - real database. A BF handoff whose business start date is
// only a year (the Accord LOC "Year began operations" field) used to fail the insert on the DATE
// column, so no BI application was created. It must now be created, with the year kept.
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { pool } from "../../db";
import router from "../biApplicationsFromBfRoutes";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", router);
  return a;
}
const token = () => jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET || "test-shared-secret-min-10");

describe("from-bf handoff with partial dates (real database)", () => {
  it("creates the application when the start date is only a year", async () => {
    const bfId = "44444444-4444-4444-8444-444444444444";
    const r = await request(app()).post("/api/v1/bi/applications/from-bf").set("Authorization", `Bearer ${token()}`).send({
      bf_application_id: bfId, guarantor_name: "Year Only", guarantor_email: "year@example.com",
      guarantor_phone: "+15875550199", guarantor_dob: "03/04/1980", business_name: "Year Co",
      formation_date: "2015", loan_amount: 250000, pgi_limit: 200000, country: "CA", co_guarantors: [],
    });
    expect(r.status).toBe(200);
    const row = await pool.query(
      `SELECT to_char(formation_date, 'YYYY-MM-DD') AS formation_date, guarantor_dob, data->>'formation_date' AS raw_formation, data->>'guarantor_dob' AS raw_dob
         FROM bi_applications WHERE public_id = $1`, [r.body.public_id]);
    expect(row.rows[0]).toEqual({ formation_date: "2015-01-01", guarantor_dob: null, raw_formation: "2015", raw_dob: "03/04/1980" });
  });
});
