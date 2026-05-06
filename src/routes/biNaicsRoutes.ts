import { Router } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";

const router = Router();

router.get("/naics", async (req, res) => {
  const q = String((req.query.q ?? "")).trim();
  const country = String((req.query.country ?? "CA")).trim().toUpperCase();
  if (!["CA", "US"].includes(country)) {
    return badRequest(res, "country must be CA or US");
  }
  if (q.length < 2) {
    return ok(res, { results: [] });
  }

  const isNumeric = /^\d+$/.test(q);
  if (isNumeric) {
    const r = await pool.query<{ code: string; title: string; country: string }>(
      `SELECT code, title, country
         FROM naics_codes
        WHERE country = $1 AND code LIKE $2
        ORDER BY code
        LIMIT 25`,
      [country, q + "%"]
    );
    return ok(res, { results: r.rows });
  }

  const r = await pool.query<{ code: string; title: string; country: string }>(
    `SELECT code, title, country
       FROM naics_codes
      WHERE country = $1 AND lower(title) LIKE $2
      ORDER BY title
      LIMIT 25`,
    [country, `%${q.toLowerCase()}%`]
  );
  return ok(res, { results: r.rows });
});

export default router;
