// BI_PGI_ALIGNMENT_v56 — SMS-only staff notifications (no email per Todd).
import twilio from "twilio";
import { pool } from "../db";
import { logger } from "../platform/logger";
type NotifyKind = "contact_form" | "new_application";
function getTwilio() { const sid = process.env.TWILIO_ACCOUNT_SID; const tok = process.env.TWILIO_AUTH_TOKEN; if (!sid || !tok) return null; return twilio(sid, tok); }
export async function notifyStaff(kind: NotifyKind, message: string): Promise<{ sent: number; skipped: number }> { const col = kind === "contact_form" ? "notify_contact_form" : "notify_new_application"; const recipients = await pool.query<{ phone_e164: string }>(`SELECT phone_e164 FROM bi_staff_notify_recipients WHERE is_active = TRUE AND ${col} = TRUE`); if (!recipients.rows.length) return { sent: 0, skipped: 0 }; const client = getTwilio(); const from = process.env.TWILIO_FROM; if (!client || !from) { logger.warn({ kind, count: recipients.rows.length }, "staff SMS skipped — Twilio not configured"); return { sent: 0, skipped: recipients.rows.length }; } let sent = 0; let skipped = 0; for (const r of recipients.rows) { try { await client.messages.create({ from, to: r.phone_e164, body: message }); sent += 1; } catch (err) { logger.error({ err, to: r.phone_e164 }, "staff SMS send failed"); skipped += 1; } } return { sent, skipped }; }
