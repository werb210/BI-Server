// BI_SERVER_BLOCK_v213_LENDER_APPLICATIONS_POST_v1
// BI_SERVER_BLOCK_v223_LENDER_CARRIER_FORWARDING_v1
// BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1
// BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1
// BI_SERVER_BLOCK_v224_LENDER_NAME_ATTRIBUTION_v1
//   - Lender name pulled from bi_lenders.company_name and forwarded to PGI
//     so the carrier knows which downstream lender originated each deal.
import express, { type NextFunction, type Request, type Response } from "express"; // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1
import jwt from "jsonwebtoken";
import { notifyStaff } from "../services/staffNotifyService";
import { pool } from "../db";
import { pgiSubmit } from "../services/pgiAdapter";
import { logger } from "../platform/logger";
const router = express.Router();
function genCode(): string { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let out = ""; for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }
function num(v: any): number | null { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[,$\s]/g, "")); return Number.isFinite(n) ? n : null; }
function bool(v: any): boolean { if (v === true || v === false) return v; if (typeof v === "string") return v.toLowerCase() === "yes" || v.toLowerCase() === "true"; return Boolean(v); }
function getLenderId(req: Request): string | null { const auth = req.header("authorization") || ""; const m = auth.match(/^Bearer\s+(.+)$/i); if (!m) return null; const secret = process.env.JWT_SECRET; if (!secret) return null; try { const payload = jwt.verify(m[1], secret) as any; if (payload?.kind !== "lender" || !payload?.id) return null; return String(payload.id); } catch { return null; } }
function getLenderUserId(req: Request): string | null { const auth = req.header("authorization") || ""; const m = auth.match(/^Bearer\s+(.+)$/i); if (!m) return null; const secret = process.env.JWT_SECRET; if (!secret) return null; try { const payload = jwt.verify(m[1], secret) as any; if (payload?.kind !== "lender" || !payload?.user_id) return null; return String(payload.user_id); } catch { return null; } }
router.post("/api/v1/lender/applications", async (req: Request, res: Response, next: NextFunction) => {
  // BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1 — flat-body callers (documented programmatic API)
  if (!req.body || typeof req.body !== "object" || !req.body.guarantor || typeof req.body.guarantor !== "object") {
    return next();
  }
  const lenderId = getLenderId(req); if (!lenderId) return res.status(401).json({ error: "unauthorized", message: "Valid lender Bearer token required" });
  const lenderUserId = getLenderUserId(req);
  const b = req.body || {};
  const required: Array<[string, any]> = [["company_name", b.company_name],["guarantor.name", b.guarantor?.name],["guarantor.phone", b.guarantor?.phone],["business.naics", b.business?.naics],["business.start_date", b.business?.start_date],["loan.amount", b.loan?.amount],["loan.pgi_limit", b.loan?.pgi_limit],["financials.revenue_last_year", b.financials?.revenue_last_year ?? b.financials?.annual_revenue],["financials.ebitda_last_year", b.financials?.ebitda_last_year ?? b.financials?.ebitda],];
  const missing = required.filter(([_, v]) => v === undefined || v === null || v === "").map(([k]) => k); if (missing.length > 0) return res.status(400).json({ error: "validation", missing });
  const applicationCode = genCode();
  const country = (b.business?.country || "CA") as "CA" | "US"; const naics_code = String(b.business?.naics); const formation_date = String(b.business?.start_date); const loan_amount = num(b.loan?.amount) || 0; const pgi_limit = num(b.loan?.pgi_limit) || 0; const annual_revenue = num(b.financials?.revenue_last_year ?? b.financials?.annual_revenue) || 0; const ebitda = num(b.financials?.ebitda_last_year ?? b.financials?.ebitda) || 0; const total_debt = num(b.financials?.total_debt) || 0; const monthly_debt_service = num(b.financials?.monthly_payments ?? b.financials?.monthly_debt_service) || 0; const collateral_value = num(b.financials?.collateral_value) || 0; const enterprise_value = num(b.financials?.enterprise_value) || 0; const bankruptcy_history = bool(b.risk?.bankruptcy_history); const insolvency_history = bool(b.risk?.insolvency_history); const judgment_history = bool(b.risk?.judgment_history);
  const coreInputs = { country, naics: naics_code, naics_code, business_start_date: formation_date, formation_date, loan_amount, pgi_limit, use_of_proceeds: b.loan?.use_of_proceeds || "expansion", estimated_close_date: b.loan?.estimated_close_date ?? b.loan?.loan_funding_date, loan_funding_date: b.loan?.loan_funding_date, policy_start_date: b.loan?.policy_start_date, revenue: annual_revenue, annual_revenue, ebitda, total_debt, monthly_payments: monthly_debt_service, monthly_debt_service, collateral_value, enterprise_value, bankruptcy_history, insolvency_history, judgment_history };
  // BI_SERVER_BLOCK_v224_LENDER_NAME_ATTRIBUTION_v1 — pull the submitting lender's company name so
  // we can a) attribute the row in bi_applications.lender_name and
  // b) tell PGI which downstream lender originated the deal.
  let lenderCompanyName: string | null = null;
  let lenderIsDemo = false;
  try {
    const lr = await pool.query(`SELECT company_name, is_demo FROM bi_lenders WHERE id = $1 LIMIT 1`, [lenderId]);
    lenderCompanyName = (lr.rows[0]?.company_name as string | undefined) || null;
    lenderIsDemo = lr.rows[0]?.is_demo === true;
  } catch {
    // Non-fatal: row still saved without lender_name; staff can fix in BI silo.
  }
  const result = await pool.query(`INSERT INTO bi_applications (entity_type, status, source, lender_id, created_by_lender_id, created_by_lender_user_id, application_code, company_name, guarantor_name, guarantor_phone, guarantor_email, lender_name, is_demo, core_inputs, consents, lender_notes, created_by_actor, created_at, updated_at) VALUES ('applicant', 'new_application', 'lender', $1, $1, $12, $2, $3, $4, $5, $6, $10, $11, $7::jsonb, $8::jsonb, $9, 'lender', NOW(), NOW()) RETURNING id, application_code` /* BI_SERVER_BLOCK_v245_LIVE_TEST_FIXES_PT2_v1 */, [lenderId, applicationCode, b.company_name, b.guarantor?.name, b.guarantor?.phone, b.guarantor?.email || null, JSON.stringify(coreInputs), JSON.stringify({ data_use: true, credit_pull: true, info_accurate: true, source: "lender_attestation" }), b.lender_notes || null, lenderCompanyName, lenderIsDemo, lenderUserId]);
  const row = result.rows[0]; const appId: string = row.id; const code: string = row.application_code;
  // BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1
// BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1 — every outbound carrier call is captured.
  let pgi_application_id: string | null = null;
  let pgi_status: string | null = null;
  let pgi_error: string | null = null;
  const carrierRequestBody = {
    guarantor_name: b.guarantor?.name,
    guarantor_email: b.guarantor?.email || `${(b.guarantor?.phone || "unknown").replace(/[^0-9]/g, "")}@no-email.boreal`,
    business_name: b.company_name,
    lender_name: lenderCompanyName ?? undefined,
    form_data: { country, naics_code, formation_date, loan_amount, pgi_limit, annual_revenue, ebitda, total_debt, monthly_debt_service, collateral_value, enterprise_value, bankruptcy_history, insolvency_history, judgment_history },
  };
  try {
    let submit;
    if (lenderIsDemo) {
      // BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1 — demo apps never hit the real carrier even
      // when USE_PGI_STUB=false. Synthesize a stub response so the visible
      // pipeline behaviour matches a real submission.
      submit = {
        application_id: `STUB_APP_DEMO_${Date.now()}`,
        status: "received",
        message: "Demo submission — carrier call skipped.",
      } as any;
    } else {
      submit = await pgiSubmit(carrierRequestBody);
    }
    pgi_application_id = submit.application_id;
    pgi_status = submit.status || "received";
    await pool.query(
      `UPDATE bi_applications
          SET pgi_application_id=$1,
              status='submitted',
              carrier_received_at=NOW(),
              carrier_last_event='application.submitted',
              carrier_last_event_at=NOW(),
              carrier_submission_request=$2::jsonb,
              carrier_submission_response=$3::jsonb,
              updated_at=NOW()
        WHERE id=$4`,
      [pgi_application_id, JSON.stringify(carrierRequestBody), JSON.stringify(submit), appId],
    );
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES($1, 'system', 'pgi.submit_succeeded', $2, $3::jsonb)`,
      [appId, `Submitted to carrier — PGI id ${pgi_application_id}`, JSON.stringify({ request: carrierRequestBody, response: submit })],
    ).catch(() => {});
  } catch (e: any) {
    pgi_error = String(e?.message ?? e);
    logger.error({ application_id: appId, lender_id: lenderId, err: pgi_error }, "lender_app_pgi_submit_failed");
    await pool.query(
      `UPDATE bi_applications
          SET carrier_submission_request=$1::jsonb,
              carrier_submission_error=$2,
              carrier_last_event='application.submit_failed',
              carrier_last_event_at=NOW(),
              updated_at=NOW()
        WHERE id=$3`,
      [JSON.stringify(carrierRequestBody), pgi_error, appId],
    ).catch(() => {});
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES($1, 'system', 'pgi.submit_failed', $2, $3::jsonb)`,
      [appId, `Carrier submission failed: ${pgi_error}`, JSON.stringify({ request: carrierRequestBody, error: pgi_error })],
    ).catch(() => {});
  }
  void notifyStaff("new_application", `New BI lender app: ${(b as any).business_name || (b as any).company_name || "Untitled"}`).catch(() => {});
  return res.status(201).json({ ok: true, id: appId, application_code: code, pgi_application_id, pgi_status, pgi_error });
});
export default router;
