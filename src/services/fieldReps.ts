// BI_SERVER_FIELD_REPS_v1 - outside reps who collect contacts at events (a business card scan, a typed email or mobile,
// or someone using the rep's QR code). Every contact is logged against the rep and tagged in the CRM so the rep gets
// credit when that contact sends deals. A new contact is emailed the information page; if that email is not opened
// within 72 hours and we have a mobile number, one text follows.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../platform/jwtSecret";
import { logger } from "../platform/logger";
import { normalizeE164 } from "../util/phoneE164";

export type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const SITE = () => (process.env.BI_WEBSITE_URL ?? "https://www.boreal.insure").replace(/\/+$/, "");
export const API = () => (process.env.BI_PUBLIC_API_URL ?? process.env.BI_SERVER_PUBLIC_URL ?? "https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net").replace(/\/+$/, "");
export const BOOK_URL = "https://www.boreal.financial/book-pgi";
export const SMS_AFTER_HOURS = 72;
export const MAX_PIN_TRIES = 5;
export const PIN_LOCK_MINUTES = 15;

// ------------------------------------------------------------------ codes, PINs, tokens
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
export function newRepCode(): string {
  let s = "";
  for (let i = 0; i < 6; i += 1) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
export const validRepCode = (raw: unknown): string | null => {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^[a-z0-9]{4,12}$/.test(s) ? s : null;
};
export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
export function hashPin(pin: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}
export function pinMatches(pin: string, stored: string): boolean {
  const [salt, hex] = String(stored).split(":");
  if (!salt || !hex) return false;
  const a = scryptSync(String(pin), salt, 32), b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export const newTrackToken = (): string => randomBytes(18).toString("base64url");

const AUD = "bi-field-rep";
export function signRepToken(repId: string): string {
  return jwt.sign({ kind: "field_rep", rep_id: repId }, getJwtSecret(), { expiresIn: "12h", audience: AUD });
}
export function readRepToken(token: string): string | null {
  try {
    const c = jwt.verify(token, getJwtSecret(), { audience: AUD }) as { kind?: string; rep_id?: string };
    return c.kind === "field_rep" && c.rep_id ? String(c.rep_id) : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ links
export const repPageUrl = (code: string) => `${SITE()}/rep/${encodeURIComponent(code)}`;
/** What the rep's QR code opens: the public information page, credited to the rep. */
export const repShareUrl = (code: string) => `${SITE()}/us-lenders?rep=${encodeURIComponent(code)}`;
export const contactInfoUrl = (code: string, token: string) => `${SITE()}/us-lenders?rep=${encodeURIComponent(code)}&c=${encodeURIComponent(token)}`;
export const bookUrl = (code: string) => `${BOOK_URL}?rep=${encodeURIComponent(code)}`;

// ------------------------------------------------------------------ contacts
export type Rep = { id: string; code: string; full_name: string; company_name: string | null; email: string | null; phone_e164: string | null; active: boolean };
export type ContactInput = { full_name?: unknown; company_name?: unknown; title?: unknown; email?: unknown; phone?: unknown; notes?: unknown };
export type CleanContact = { full_name: string | null; company_name: string | null; title: string | null; email: string | null; phone_e164: string | null; notes: string | null };

const text = (v: unknown, max: number): string | null => { const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max); return s || null; };
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Tidies what a rep typed or a card scan returned. Needs an email or a mobile number. */
export function cleanContact(raw: ContactInput): { ok: true; value: CleanContact } | { ok: false; message: string } {
  const emailRaw = text(raw.email, 200);
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.toLowerCase() : null;
  const phoneRaw = text(raw.phone, 40);
  const phone = phoneRaw ? normalizeE164(phoneRaw) : null;
  if (emailRaw && !email) return { ok: false, message: "That email address does not look right." };
  if (phoneRaw && !phone) return { ok: false, message: "That phone number does not look right. Use a 10-digit US or Canadian number." };
  if (!email && !phone) return { ok: false, message: "Enter an email address or a mobile number." };
  return { ok: true, value: { full_name: text(raw.full_name, 120), company_name: text(raw.company_name, 160), title: text(raw.title, 120), email, phone_e164: phone, notes: text(raw.notes, 1000) } };
}

export type FollowUpDeps = {
  sendEmail: (m: { to: string; subject: string; html: string; text: string }) => Promise<unknown>;
  mirror: (c: CleanContact, rep: Rep) => Promise<string | null>;
  now?: () => Date;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const firstName = (full: string | null) => (full ?? "").trim().split(/\s+/)[0] ?? "";
export const MAIL_ADDRESS = "Boreal Risk Management, 450 Sparling Crt SW, Edmonton, AB T6X 1G9, Canada";

/** The email a new contact gets: what PGI is, the information page, and how to book a call. */
export function followUpEmail(c: CleanContact, rep: Rep, token: string, source: "card" | "manual" | "qr"): { subject: string; html: string; text: string } {
  const hi = firstName(c.full_name) ? `Hi ${firstName(c.full_name)},` : "Hello,";
  const why = source === "qr"
    ? "Thanks for your interest in Personal Guarantee Insurance. Here is the information you asked for."
    : `${rep.full_name} passed your details to us after you met. Here is the information on Personal Guarantee Insurance.`;
  const info = contactInfoUrl(rep.code, token), book = bookUrl(rep.code);
  const lines = [
    hi, "", why, "",
    "Personal Guarantee Insurance (PGI) covers the person who signs the personal guarantee on a business loan. If the business fails and the lender calls the guarantee, the policy pays up to 80% of it. Lenders and loan brokers offer it so more borrowers are willing to sign.",
    "", `The details for banks, lenders and brokers: ${info}`, `Book a 15-minute call or a Teams meeting: ${book}`, "Or call us at (866) 631-8939.",
    "", "Boreal Risk Management", "", `You are getting this one email because ${source === "qr" ? "you asked for it on our page" : `you met ${rep.full_name}`}. If you would rather not hear from us, reply with "unsubscribe".`, MAIL_ADDRESS,
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0b1f3a;max-width:600px">
<p>${esc(hi)}</p><p>${esc(why)}</p>
<p><strong>Personal Guarantee Insurance (PGI)</strong> covers the person who signs the personal guarantee on a business loan. If the business fails and the lender calls the guarantee, the policy pays up to 80% of it. Lenders and loan brokers offer it so more borrowers are willing to sign.</p>
<p><a href="${esc(info)}" style="display:inline-block;background:#0b1f3a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">See the details for lenders and brokers</a></p>
<p><a href="${esc(book)}" style="color:#0b1f3a;font-weight:bold">Book a 15-minute call or a Teams meeting</a>, or call us at (866) 631-8939.</p>
<p>Boreal Risk Management</p>
<p style="font-size:12px;color:#475569">You are getting this one email because ${esc(source === "qr" ? "you asked for it on our page" : `you met ${rep.full_name}`)}. If you would rather not hear from us, reply with "unsubscribe".<br>${esc(MAIL_ADDRESS)}</p>
<img src="${esc(API())}/api/v1/field/o/${esc(token)}.gif" width="1" height="1" alt="" style="display:block;border:0">
</div>`;
  return { subject: "Personal Guarantee Insurance: the details for lenders and brokers", html, text: lines.join("\n") };
}

/** The one text that follows when the email was not opened. */
export function followUpSms(rep: Rep, token: string): string {
  return `Boreal Risk Management: ${firstName(rep.full_name) || "our colleague"} shared your details with us. Personal Guarantee Insurance info for lenders and brokers: ${contactInfoUrl(rep.code, token)} Reply STOP to opt out.`;
}

/** Logs a contact against the rep (one row per rep and email, or rep and phone), tags the CRM contact, and sends the
 *  information email once. Returns the row and whether it was new. */
export async function addFieldContact(db: Q, rep: Rep, c: CleanContact, source: "card" | "manual" | "qr", deps: FollowUpDeps): Promise<{ id: string; created: boolean; emailed: boolean }> {
  const now = (deps.now ?? (() => new Date()))();
  const found = await db.query(
    `SELECT id::text, track_token, email_sent_at FROM bi_field_contacts
      WHERE rep_id = $1::uuid AND (($2::text IS NOT NULL AND lower(email) = $2) OR ($3::text IS NOT NULL AND phone_e164 = $3))
      ORDER BY created_at ASC LIMIT 1`, [rep.id, c.email, c.phone_e164]);
  let id: string, token: string, created = false, alreadyEmailed = false;
  if (found.rows[0]) {
    id = found.rows[0].id; token = found.rows[0].track_token; alreadyEmailed = Boolean(found.rows[0].email_sent_at);
    await db.query(
      `UPDATE bi_field_contacts SET full_name = COALESCE($2, full_name), company_name = COALESCE($3, company_name), title = COALESCE($4, title),
              email = COALESCE($5, email), phone_e164 = COALESCE($6, phone_e164), notes = COALESCE($7, notes), updated_at = now()
        WHERE id = $1::uuid`, [id, c.full_name, c.company_name, c.title, c.email, c.phone_e164, c.notes]);
  } else {
    token = newTrackToken(); created = true;
    const ins = await db.query(
      `INSERT INTO bi_field_contacts (rep_id, full_name, company_name, title, email, phone_e164, notes, source, track_token)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text`,
      [rep.id, c.full_name, c.company_name, c.title, c.email, c.phone_e164, c.notes, source, token]);
    id = ins.rows[0].id;
  }
  try {
    const contactId = await deps.mirror(c, rep);
    if (contactId) await db.query(`UPDATE bi_field_contacts SET contact_id = $2::uuid WHERE id = $1::uuid`, [id, contactId]);
  } catch (err) { logger.warn({ err: String(err), field_contact_id: id }, "[field-reps] CRM tag failed"); }

  let emailed = false;
  if (c.email && !alreadyEmailed) {
    const m = followUpEmail(c, rep, token, source);
    try {
      await deps.sendEmail({ to: c.email, ...m });
      emailed = true;
      await db.query(
        `UPDATE bi_field_contacts SET email_sent_at = $2, email_error = NULL,
                sms_due_at = CASE WHEN $4::boolean AND phone_e164 IS NOT NULL AND sms_sent_at IS NULL THEN $3 ELSE sms_due_at END WHERE id = $1::uuid`,
        // Someone who asked on the information page has already seen it: no text follows for them.
        [id, now.toISOString(), new Date(now.getTime() + SMS_AFTER_HOURS * 3600_000).toISOString(), source !== "qr"]);
    } catch (err) {
      await db.query(`UPDATE bi_field_contacts SET email_error = $2 WHERE id = $1::uuid`, [id, String(err instanceof Error ? err.message : err).slice(0, 300)]);
      logger.warn({ err: String(err), field_contact_id: id }, "[field-reps] information email not sent");
    }
  }
  return { id, created, emailed };
}

/** The email was opened (the tracking image loaded) or its link was followed: no text will follow. */
export async function markOpened(db: Q, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return false;
  const r = await db.query(`UPDATE bi_field_contacts SET email_opened_at = COALESCE(email_opened_at, now()), sms_due_at = NULL, updated_at = now() WHERE track_token = $1 RETURNING id`, [token]);
  return r.rows.length > 0;
}

/** Texts go out on weekdays inside business hours in every US time zone: 15:00-22:00 UTC (10am-5pm Eastern in winter). */
export function smsWindowOpen(now: Date): boolean {
  const day = now.getUTCDay(), h = now.getUTCHours();
  return day >= 1 && day <= 5 && h >= 15 && h < 22;
}

/** Sends the one follow-up text to contacts whose email went unopened for 72 hours. Each row is claimed before it is
 *  sent, so two server instances cannot both text the same person. */
export async function runFollowUpSmsTick(db: Q, sendSms: (to: string, body: string) => Promise<unknown>, now: Date = new Date()): Promise<{ sent: number; failed: number; skipped: boolean }> {
  // BI_FIELD_SMS=off stops the follow-up text entirely (the email and everything else carry on).
  if (String(process.env.BI_FIELD_SMS ?? "").trim().toLowerCase() === "off") return { sent: 0, failed: 0, skipped: true };
  if (!smsWindowOpen(now)) return { sent: 0, failed: 0, skipped: true };
  const due = await db.query(
    `UPDATE bi_field_contacts fc SET sms_sent_at = $1
       FROM bi_field_reps r
      WHERE r.id = fc.rep_id
        AND fc.id IN (SELECT id FROM bi_field_contacts
                       WHERE sms_sent_at IS NULL AND sms_due_at IS NOT NULL AND sms_due_at <= $1 AND email_opened_at IS NULL AND phone_e164 IS NOT NULL
                       ORDER BY sms_due_at ASC LIMIT 25 FOR UPDATE SKIP LOCKED)
      RETURNING fc.id::text, fc.phone_e164, fc.track_token, r.code, r.full_name`, [now.toISOString()]);
  let sent = 0, failed = 0;
  for (const row of due.rows) {
    try {
      await sendSms(row.phone_e164, followUpSms({ code: row.code, full_name: row.full_name } as Rep, row.track_token));
      sent += 1;
    } catch (err) {
      failed += 1;
      await db.query(`UPDATE bi_field_contacts SET sms_error = $2 WHERE id = $1::uuid`, [row.id, String(err instanceof Error ? err.message : err).slice(0, 300)]);
    }
  }
  if (sent || failed) logger.info({ sent, failed }, "[field-reps] follow-up texts");
  return { sent, failed, skipped: false };
}

/** A stable short reference for logs (never the token itself). */
export const tokenRef = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 8);
