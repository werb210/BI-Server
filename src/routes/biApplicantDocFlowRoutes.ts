// BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
const router = Router();
interface ApplicantReq extends Request { applicantPhone?: string; }
function authApplicant(req: ApplicantReq, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return res.status(401).json({ error: "missing_bearer" });
  try {
    const payload = jwt.verify(m[1], env.JWT_SECRET || "dev-missing-jwt-secret") as any;
    if (payload?.kind !== "applicant" || !payload?.phone) return res.status(401).json({ error: "wrong_kind" });
    req.applicantPhone = String(payload.phone);
    return next();
  } catch { return res.status(401).json({ error: "invalid_token" }); }
}
router.post("/applicants/applications/:publicId/defer-docs", authApplicant, async (req: ApplicantReq, res) => {
  const r = await pool.query(`SELECT id, applicant_phone_e164, guarantor_phone, status, docs_deferred_at FROM bi_applications WHERE public_id = $1 LIMIT 1`, [req.params.publicId]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!owners.includes(req.applicantPhone)) return res.status(403).json({ error: "not_owner" });
  if (!["in_progress", "document_review"].includes(String(app.status))) return res.status(409).json({ error: "wrong_status", current: app.status });
  if (app.docs_deferred_at) return res.json({ ok: true, idempotent: true });
  await pool.query(`UPDATE bi_applications SET docs_deferred_at = NOW(), updated_at = NOW() WHERE id = $1`, [app.id]);
  await pool.query(`INSERT INTO bi_activity(application_id, actor_type, event_type, summary) VALUES($1, 'applicant', 'docs_deferred', 'Applicant chose to upload documents later')`, [app.id]).catch(() => {});
  return res.json({ ok: true });
});
router.get("/applicants/me/pending-application", authApplicant, async (req: ApplicantReq, res) => {
  const r = await pool.query(`SELECT public_id, status, docs_deferred_at, created_at FROM bi_applications WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1) AND status IN ('in_progress', 'document_review') AND created_at >= NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 1`, [req.applicantPhone]);
  if (!r.rows[0]) return res.json({ pending: null });
  return res.json({ pending: { public_id: r.rows[0].public_id, status: r.rows[0].status, deferred: !!r.rows[0].docs_deferred_at, next_path: `/applications/${r.rows[0].public_id}/documents` } });
});
export default router;
