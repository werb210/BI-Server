// BI_PGI_ALIGNMENT_v56 - SMS-only staff notifications (no email per Todd).
import twilio from "twilio";
// BI_SERVER_BLOCK_v262_SMS_DELIVERABILITY_v1
import { isUndeliverableNumber, isSendableBody, isPermanentSmsFailure } from "../lib/smsDeliverability";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { maskPhone } from "../util/mask"; // BI_SERVER_v789_LOG_MASKING

type NotifyKind = "contact_form" | "new_application";

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  return twilio(sid, tok);
}

export async function notifyStaff(kind: NotifyKind, message: string): Promise<{ sent: number; skipped: number }> {
  const col = kind === "contact_form" ? "notify_contact_form" : "notify_new_application";
  const recipients = await pool.query<{ phone_e164: string }>(
    `SELECT phone_e164 FROM bi_staff_notify_recipients WHERE is_active = TRUE AND ${col} = TRUE`,
  );
  if (!recipients.rows.length) return { sent: 0, skipped: 0 };
  const client = getTwilio();
  const from = process.env.TWILIO_FROM;
  if (!client || !from) {
    logger.warn({ kind, count: recipients.rows.length }, "staff SMS skipped - Twilio not configured");
    return { sent: 0, skipped: recipients.rows.length };
  }
  let sent = 0;
  let skipped = 0;
  if (!isSendableBody(message)) {
    logger.warn({ kind }, "staff SMS skipped - empty body");
    return { sent: 0, skipped: recipients.rows.length };
  }
  for (const r of recipients.rows) {
    if (isUndeliverableNumber(r.phone_e164)) {
      logger.warn({ kind, to: maskPhone(r.phone_e164) }, "staff SMS skipped - undeliverable number");
      skipped += 1;
      continue;
    }
    try {
      await client.messages.create({ from, to: r.phone_e164, body: message });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, to: maskPhone(r.phone_e164), permanent: isPermanentSmsFailure(err), code: (err as { code?: number })?.code },
        "staff SMS send failed",
      );
      skipped += 1;
    }
  }
  return { sent, skipped };
}

// BI_SERVER_v789_STAFF_ALERT_THROTTLE - public forms (contact form /crm/lead,
// Maya chat) text staff on every submission, so one sender could flood staff
// phones (and the Twilio bill). At most one staff alert per 10 minutes per
// sender: pass every key that identifies the sender (phone, IP); if ANY of them
// alerted within the window the alert is suppressed, otherwise all keys are
// stamped. In-memory, per instance.
export const STAFF_ALERT_WINDOW_MS = 10 * 60 * 1000;
const STAFF_ALERT_MAX_KEYS = 20_000;
const lastStaffAlertAt = new Map<string, number>();

export function staffAlertAllowed(keys: Array<string | null | undefined>, now: number = Date.now()): boolean {
  const live = keys.map((k) => String(k ?? "").trim()).filter(Boolean);
  if (!live.length) return true;
  for (const k of live) {
    const at = lastStaffAlertAt.get(k);
    if (at !== undefined && now - at < STAFF_ALERT_WINDOW_MS) return false;
  }
  if (lastStaffAlertAt.size >= STAFF_ALERT_MAX_KEYS) {
    for (const [k, at] of lastStaffAlertAt) if (now - at >= STAFF_ALERT_WINDOW_MS) lastStaffAlertAt.delete(k);
    while (lastStaffAlertAt.size >= STAFF_ALERT_MAX_KEYS) {
      const first = lastStaffAlertAt.keys().next().value;
      if (first === undefined) break;
      lastStaffAlertAt.delete(first);
    }
  }
  for (const k of live) lastStaffAlertAt.set(k, now);
  return true;
}

/** Test hook: forget every throttle stamp. */
export function resetStaffAlertThrottle(): void {
  lastStaffAlertAt.clear();
}
