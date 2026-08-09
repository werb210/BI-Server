// BI_CLIENT_SELECTION_v23 - step 2, the no-contract path. GET /applicants/products
// (v21) lists what is available; this is how the applicant's own picks are saved.
// Contract-derived lines are written by the requirement-confirm route and are
// deliberately untouchable here: a coverage the subcontract demands is not the
// applicant's to remove from a checkbox list.
import { Router } from "express";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();

const COUNTRIES = new Set(["CA", "US"]);
function normCountry(raw: unknown): "CA" | "US" {
  const v = String(raw ?? "").trim().toUpperCase();
  return COUNTRIES.has(v) ? (v as "CA" | "US") : "CA";
}

async function ownedApplication(publicIdOrId: string, phone: string) {
  // "me" resolves the caller's in-flight application. Step 1 leaves it in
  // 'created', which /applicants/me/pending-application deliberately excludes,
  // so the no-contract path needs its own way to find it.
  if (publicIdOrId === "me") {
    const mine = await pool.query(
      `SELECT id, public_id, country, applicant_phone_e164, guarantor_phone
         FROM bi_applications
        WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
          AND status IN ('created','in_progress')
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!mine.rows[0]) return { app: null as any, error: "not_found" as const };
    return { app: mine.rows[0], error: null };
  }
  const r = await pool.query(
    `SELECT id, public_id, country, applicant_phone_e164, guarantor_phone
       FROM bi_applications WHERE public_id = $1 OR id::text = $1 LIMIT 1`,
    [publicIdOrId],
  );
  const app = r.rows[0];
  if (!app) return { app: null as any, error: "not_found" as const };
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!owners.includes(phone)) return { app: null as any, error: "not_owner" as const };
  return { app, error: null };
}

async function currentSelection(applicationId: string) {
  const r = await pool.query(
    `SELECT p.code, p.display_name, p.carrier, p.coverage_category, p.description,
            p.sort_order, ap.source
       FROM bi_application_products ap JOIN bi_products p ON p.id = ap.product_id
      WHERE ap.application_id = $1
      ORDER BY p.sort_order ASC, p.display_name ASC`,
    [applicationId],
  );
  return r.rows;
}

router.get("/applicants/applications/:id/products", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  res.json({
    applicationId: app.public_id,
    country: normCountry(app.country),
    selected: await currentSelection(app.id),
  });
});

// Replace-set rather than add-one: the client sends the full list of what is
// ticked, so unticking is expressible without a second endpoint.
router.post("/applicants/applications/:id/products", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });

  const raw = Array.isArray(req.body?.codes) ? req.body.codes : [];
  const codes = Array.from(new Set(raw.map((c: unknown) => String(c ?? "").trim()).filter(Boolean))).slice(0, 40);
  const country = normCountry(app.country);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM bi_application_products ap USING bi_products p
        WHERE ap.product_id = p.id AND ap.application_id = $1
          AND ap.source = 'client_added'
          AND NOT (p.code = ANY($2::text[]))`,
      [app.id, codes],
    );
    if (codes.length > 0) {
      await client.query(
        `INSERT INTO bi_application_products (application_id, product_id, source)
         SELECT $1, p.id, 'client_added' FROM bi_products p
          WHERE p.country = $3 AND p.active = TRUE AND p.code = ANY($2::text[])
         ON CONFLICT (application_id, product_id) DO NOTHING`,
        [app.id, codes, country],
      );
    }
    await client.query(
      `UPDATE bi_applications SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1 AND status = 'created'`,
      [app.id],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
     VALUES($1,'applicant','coverage_selected',$2)`,
    [app.id, `Applicant selected ${codes.length} coverage line(s)`],
  ).catch(() => {});

  res.json({
    applicationId: app.public_id,
    country: normCountry(app.country),
    selected: await currentSelection(app.id),
  });
});

export default router;
