// BI_PGI_ALIGNMENT_v56 — public contact form → CRM + staff SMS.
import { Router } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { mirrorToContact } from "../services/crmMirrorService";
import { notifyStaff } from "../services/staffNotifyService";
import { logger } from "../platform/logger";
const router = Router();
router.post("/crm/lead", async (req, res) => { const b = (req.body ?? {}) as Record<string, unknown>; const name = String(b.name ?? "").trim(); const email = String(b.email ?? "").trim(); const phone = String(b.phone ?? "").trim(); const company = String(b.company ?? "").trim() || null; if (!name || !email || !phone) return badRequest(res, "name, email, and phone required"); try { const result = await mirrorToContact({ source: "applicant", full_name: name, email, phone_e164: phone, company_name: company, lifecycle_stage: "lead", extra_tags: ["contact_form"] }); await pool.query(`INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta) VALUES (NULL, 'system', 'contact_form_submitted', 'Contact form submission', $1::jsonb)`, [JSON.stringify({ contact_id: result.contact_id, name, email, phone, company })]); void notifyStaff("contact_form", `New BI contact: ${name} (${phone}) - ${company || "no company"}`).catch((err) => logger.error({ err }, "notify failed")); return ok(res, { received: true }); } catch (err) { logger.error({ err }, "contact form failed"); return badRequest(res, "submission failed"); } });
export default router;
