// BI_SENDGRID_EVENT_WEBHOOK_v1
// Receives SendGrid Event Webhook deliveries for BI marketing email.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
// The BI audience is 3,983 contacts that have never been emailed from this
// channel, so the first campaign will surface a real bounce rate. Without this,
// bounced and complained-about addresses stay in the audience and get mailed
// again on the next send - which is exactly how sender reputation is destroyed,
// and it would take info@boreal.financial down with it, since BI and BF share
// that sending identity.
//
// Hard bounces, spam reports, dropped and unsubscribes are written to
// bi_suppressions, which the audience query already excludes. So suppression is
// automatic from the first campaign onward.
//
// MOUNTED PUBLICLY AND BEFORE express.json: SendGrid cannot authenticate, and
// signature verification needs the EXACT raw bytes - any JSON re-serialisation
// changes them and every signature fails.
import { Router, raw } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { pool } from "../db";

const router: Router = Router();
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
let unsignedRequestWarningLogged = false;

export function logSendgridWebhookSigningStatus(): void {
  if (process.env.SENDGRID_WEBHOOK_PUBLIC_KEY) {
    console.info("[bi_sendgrid_webhook] signature verification enabled");
    return;
  }
  console.warn("[bi_sendgrid_webhook] WARNING: SENDGRID_WEBHOOK_PUBLIC_KEY is unset; webhook accepts unsigned writes");
}

// Events that mean "never email this address again".
// - bounce: only HARD bounces. A soft bounce is a full mailbox or a temporary
//   server problem; suppressing on those throws away deliverable contacts.
// - dropped: SendGrid refused it, usually because it is already on their
//   internal suppression list.
const SUPPRESSING = new Set(["bounce", "dropped", "spamreport", "unsubscribe", "group_unsubscribe"]);

// Must match the bi_suppressions reason CHECK constraint, or the insert throws:
//   'manual','unsubscribe','bounce','complaint','imported','reply_negative','deleted_from_crm'
function reasonFor(event: string): string {
  if (event === "spamreport") return "complaint";
  if (event === "unsubscribe" || event === "group_unsubscribe") return "unsubscribe";
  return "bounce"; // bounce + dropped
}

function isHardBounce(ev: any): boolean {
  if (ev?.event !== "bounce") return true; // not a bounce; caller already filtered
  // SendGrid sets type: "bounce" (hard) or "blocked" (soft/transient).
  return String(ev?.type ?? "bounce") === "bounce";
}

function verify(rawBody: Buffer, signature: string, timestamp: string): boolean {
  const key = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  // Not configured -> accept, matching BF-Server's behaviour. Set the key in
  // Azure to enforce; until then anyone who finds the URL can post events.
  if (!key) return true;
  if (!signature || !timestamp) return false;
  const timestampSeconds = Number(timestamp);
  const timestampFresh = Number.isFinite(timestampSeconds)
    && Math.abs(Date.now() / 1000 - timestampSeconds) <= SIGNATURE_TOLERANCE_SECONDS;
  if (!timestampFresh) return false;
  try {
    const pubPem = `-----BEGIN PUBLIC KEY-----\n${key}\n-----END PUBLIC KEY-----\n`;
    const v = crypto.createVerify("sha256");
    v.update(timestamp + rawBody.toString("utf8"));
    v.end();
    return v.verify(pubPem, signature, "base64");
  } catch {
    return false;
  }
}

router.post("/api/v1/bi/webhooks/sendgrid", raw({ type: "*/*", limit: "5mb" }), async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
  const sig = String(req.header("X-Twilio-Email-Event-Webhook-Signature") ?? "");
  const ts = String(req.header("X-Twilio-Email-Event-Webhook-Timestamp") ?? "");

  if (!process.env.SENDGRID_WEBHOOK_PUBLIC_KEY && !unsignedRequestWarningLogged) {
    unsignedRequestWarningLogged = true;
    console.warn("[bi_sendgrid_webhook] accepting unsigned request because SENDGRID_WEBHOOK_PUBLIC_KEY is unset");
  }

  if (!verify(rawBody, sig, ts)) {
    res.status(403).json({ ok: false, error: "bad_signature" });
    return;
  }

  let events: any[] = [];
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    res.status(400).json({ ok: false, error: "bad_json" });
    return;
  }

  let suppressed = 0;
  let logged = 0;

  for (const ev of events) {
    const email = String(ev?.email ?? "").trim().toLowerCase();
    const event = String(ev?.event ?? "").trim();
    if (!email || !event) continue;

    // Ledger every event, so "why did this contact not receive it" is answerable.
    await pool
      .query(
        `INSERT INTO bi_marketing_send_events (job_id, contact_id, email, event_type, detail)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          ev?.job_id ?? null,
          ev?.contact_id ?? null,
          email,
          event,
          JSON.stringify({ sg_event_id: ev?.sg_event_id ?? null, reason: ev?.reason ?? null, type: ev?.type ?? null }).slice(0, 1000),
        ],
      )
      .then(() => { logged += 1; })
      .catch(() => undefined); // a ledger failure must never lose a suppression

    if (!SUPPRESSING.has(event)) continue;
    if (!isHardBounce(ev)) continue;

    await pool
      .query(
        `INSERT INTO bi_suppressions (identifier, email, channel, reason)
         VALUES ($1, $1, 'email', $2)
         ON CONFLICT (identifier, channel) DO NOTHING`,
        [email, reasonFor(event)],
      )
      .then(() => { suppressed += 1; })
      .catch((err) => {
        console.warn("[bi_sendgrid_webhook] suppression insert failed", email, err instanceof Error ? err.message : err);
      });
  }

  // Always 200 on a verified payload. A non-2xx makes SendGrid retry the whole
  // batch, and a single bad row would replay thousands of events forever.
  res.json({ ok: true, received: events.length, suppressed, logged });
});

export default router;
