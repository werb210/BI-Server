import { Router } from "express";
import urlencoded from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
const router = Router();
router.post("/bi/twilio/sms-inbound", urlencoded.urlencoded({ extended: false }), async (req, res) => { const from = String(req.body?.From || "").trim(); const bodyRaw = String(req.body?.Body || ""); const body = bodyRaw.trim().toUpperCase(); const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]); if (from && STOP_KEYWORDS.has(body)) { try { await pool.query(`INSERT INTO bi_sms_opt_outs (phone_e164, source, raw_body) VALUES ($1, 'twilio_inbound', $2) ON CONFLICT (phone_e164) DO NOTHING`, [from, bodyRaw.slice(0, 200)]); } catch (err) { logger.error({ err, from }, "[smsInbound] failed"); } } res.set("Content-Type", "text/xml"); return res.send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>"); });
export default router;
