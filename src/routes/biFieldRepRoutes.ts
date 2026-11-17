// BI_SERVER_FIELD_REPS_v1 - outside reps who collect contacts at events.
//
// The rep's page (bi-website /rep/<code>), signed in with the rep's PIN:
//   POST /api/v1/field/login     { code, pin }                 -> { token, rep }
//   GET  /api/v1/field/me                                      -> rep, links, contacts with their status
//   POST /api/v1/field/contacts  { full_name, company_name, title, email, phone, notes, source: "card" | "manual" }
//   POST /api/v1/field/scan      { image: "data:image/jpeg;base64,..." } -> { fields } read from a business card
// Public:
//   GET  /api/v1/field/rep/:code            is this a live rep code? (the information page checks before crediting)
//   GET  /api/v1/field/o/:token.gif         the information email was opened
//   POST /api/v1/field/visit     { c }      the email's link was followed
// Staff (mounted under /api/v1/bi with requireAuth):
//   GET  /field-reps                         reps with their contact counts
//   POST /field-reps  { full_name, company_name, email, phone }   -> { rep, pin, page_url }  (the PIN is shown once)
//   POST /field-reps/:id/pin                 a new PIN (shown once)
//   PATCH /field-reps/:id  { active }
//   GET  /field-reps/:id/contacts
import { Router, type NextFunction, type Request, type Response } from "express";
import OpenAI from "openai";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { ipRateLimit } from "../lib/ipRateLimit";
import { normalizeE164 } from "../util/phoneE164";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { mirrorToContact } from "../services/crmMirrorService";
import { sendBiMarketingEmail } from "../services/biSendgridService";
import { sendOutreachSms } from "../services/smsService";
import {
  EMAIL_RE, MAX_PIN_TRIES, PIN_LOCK_MINUTES, addFieldContact, bookUrl, cleanContact, hashPin, markOpened, newPin, newRepCode, pinMatches, pinMessage, PIN_RESEND_MINUTES,
  readRepToken, repPageUrl, repShareUrl, runFollowUpSmsTick, signRepToken, validRepCode, type CleanContact, type FollowUpDeps, type Q, type Rep,
} from "../services/fieldReps";

import { agreementCleared, agreementStatus, agreementsOn, bfAgreementBridge, issueAgreement, welcomeMessage, type AgreementRep } from "../services/repAgreement";

const db = () => pool as unknown as Q;
const REP_COLS = "id::text, code, full_name, company_name, email, phone_e164, active";
// BI_SERVER_REP_AGREEMENT_v1
const AGREEMENT_COLS = "agreement_required, agreement_group_id, agreement_invite_id, agreement_sent_at, agreement_signed_at, agreement_error";

export const followUpDeps: FollowUpDeps = {
  sendEmail: (m) => sendBiMarketingEmail({ to: m.to, subject: m.subject, html: m.html, text: m.text }),
  mirror: async (c: CleanContact, rep: Rep) => {
    const r = await mirrorToContact({
      source: "applicant", full_name: c.full_name || c.email || c.phone_e164 || "Event contact", email: c.email, phone_e164: c.phone_e164,
      company_name: c.company_name, lifecycle_stage: "lead", extra_tags: ["us_lenders", "field_rep", `rep:${rep.code}`],
    });
    return r.contact_id;
  },
};

/** Credits a lead from the public information page to the rep whose QR code or link was used. Never throws. */
export async function creditLeadToRep(repCode: unknown, lead: { name?: string; email?: string; phone?: string; company?: string; audience?: unknown }): Promise<void> {
  const code = validRepCode(repCode);
  if (!code) return;
  try {
    const rep = (await db().query(`SELECT ${REP_COLS} FROM bi_field_reps WHERE lower(code) = $1 AND active`, [code])).rows[0] as Rep | undefined;
    if (!rep) return;
    const c = cleanContact({ full_name: lead.name && lead.name !== lead.email && lead.name !== lead.phone ? lead.name : null, email: lead.email, phone: lead.phone, company_name: lead.company, audience: lead.audience });
    if (c.ok) await addFieldContact(db(), rep, c.value, "qr", followUpDeps);
  } catch (err) { logger.warn({ err: String(err) }, "[field-reps] lead not credited"); }
}

// ------------------------------------------------------------------ the rep's page and public endpoints
export const fieldPublicRouter = Router();
const loginLimiter = ipRateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
const repLimiter = ipRateLimit({ windowMs: 60 * 1000, limit: 60 });
const scanLimiter = ipRateLimit({ windowMs: 60 * 60 * 1000, limit: 120 });
const openLimiter = ipRateLimit({ windowMs: 60 * 1000, limit: 120 });

fieldPublicRouter.post("/field/login", loginLimiter, async (req: Request, res: Response) => {
  const code = validRepCode(req.body?.code), pin = String(req.body?.pin ?? "").trim();
  const bad = () => res.status(401).json({ ok: false, error: "wrong_code_or_pin", message: "That PIN is not right." });
  if (!code || !/^\d{4,8}$/.test(pin)) return bad();
  const row = (await db().query(`SELECT ${REP_COLS}, pin_hash, failed_pins, locked_until FROM bi_field_reps WHERE lower(code) = $1`, [code])).rows[0];
  if (!row || !row.active) return bad();
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return res.status(429).json({ ok: false, error: "locked", message: `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes.` });
  }
  if (!pinMatches(pin, row.pin_hash)) {
    await db().query(
      `UPDATE bi_field_reps SET failed_pins = failed_pins + 1,
              locked_until = CASE WHEN failed_pins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END WHERE id = $1::uuid`,
      [row.id, MAX_PIN_TRIES, String(PIN_LOCK_MINUTES)]);
    return bad();
  }
  await db().query(`UPDATE bi_field_reps SET failed_pins = 0, locked_until = NULL WHERE id = $1::uuid`, [row.id]);
  res.json({ ok: true, token: signRepToken(row.id), rep: { code: row.code, full_name: row.full_name, company_name: row.company_name } });
});

// BI_SERVER_FIELD_REP_PIN_RECOVERY_v1 - a rep who has forgotten the PIN asks for a new one from the sign-in screen. It is
// sent to the email address and mobile number we hold for that rep, never shown on screen, and the reply is the same
// whether or not the rep exists, so the page cannot be used to find out who is a rep.
const resetLimiter = ipRateLimit({ windowMs: 60 * 60 * 1000, limit: 6 });
export const PIN_RESET_REPLY = "If we have your email or mobile on file, a new PIN is on its way. It can take a minute.";
fieldPublicRouter.post("/field/pin-reset", resetLimiter, async (req: Request, res: Response) => {
  const code = validRepCode(req.body?.code);
  const done = () => res.json({ ok: true, message: PIN_RESET_REPLY });
  if (!code) return done();
  try {
    const rep = (await db().query(
      `SELECT ${REP_COLS} FROM bi_field_reps WHERE lower(code) = $1 AND active
          AND (email IS NOT NULL OR phone_e164 IS NOT NULL)
          AND (pin_sent_at IS NULL OR pin_sent_at < now() - ($2 || ' minutes')::interval)`, [code, String(PIN_RESEND_MINUTES)])).rows[0] as Rep | undefined;
    if (!rep) return done();
    const pin = newPin();
    const m = pinMessage(rep, pin);
    let sent = 0;
    if (rep.email) { try { await sendBiMarketingEmail({ to: rep.email, subject: m.subject, html: m.html, text: m.text }); sent += 1; } catch (err) { logger.warn({ err: String(err) }, "[field-reps] PIN email failed"); } }
    if (rep.phone_e164) { try { await sendOutreachSms(rep.phone_e164, m.sms); sent += 1; } catch (err) { logger.warn({ err: String(err) }, "[field-reps] PIN text failed"); } }
    // The old PIN is only replaced once the new one has actually gone out.
    if (sent > 0) await db().query(`UPDATE bi_field_reps SET pin_hash = $2, failed_pins = 0, locked_until = NULL, pin_sent_at = now(), updated_at = now() WHERE id = $1::uuid`, [rep.id, hashPin(pin)]);
  } catch (err) { logger.warn({ err: String(err) }, "[field-reps] PIN reset failed"); }
  done();
});

async function requireRep(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
  const repId = m ? readRepToken(m[1]!) : null;
  const rep = repId ? ((await db().query(`SELECT ${REP_COLS}, ${AGREEMENT_COLS} FROM bi_field_reps WHERE id = $1::uuid AND active`, [repId])).rows[0] as (Rep & AgreementRep) | undefined) : undefined;
  if (!rep) return res.status(401).json({ ok: false, error: "sign_in_again", message: "Enter your PIN again." });
  (req as any).rep = rep;
  next();
}

// BI_SERVER_REP_AGREEMENT_v1 - a rep who has not signed the Introducer Agreement can sign in but can do nothing else.
async function requireSigned(req: Request, res: Response, next: NextFunction) {
  const rep = (req as any).rep as Rep & AgreementRep;
  if (await agreementCleared(db(), rep)) return next();
  res.status(403).json({ ok: false, error: "agreement_required", message: "Sign the Introducer Agreement to open your page." });
}

/** Where the rep signs. A fresh link each time (they expire); `signed` once it is done. */
fieldPublicRouter.get("/field/agreement", repLimiter, requireRep, async (req: Request, res: Response) => {
  const rep = (req as any).rep as Rep & AgreementRep;
  if (await agreementCleared(db(), rep)) return res.json({ ok: true, signed: true, url: null });
  if (!rep.agreement_group_id || !rep.agreement_invite_id || !rep.email) {
    return res.status(409).json({ ok: false, error: "agreement_not_ready", message: "Your agreement is not ready yet. We have been told and will send it shortly." });
  }
  try {
    const l = await bfAgreementBridge.link(rep.agreement_group_id, rep.agreement_invite_id, rep.email);
    if (l.signed) { await db().query(`UPDATE bi_field_reps SET agreement_signed_at = now(), updated_at = now() WHERE id = $1::uuid AND agreement_signed_at IS NULL`, [rep.id]); }
    res.json({ ok: true, signed: l.signed, url: l.url });
  } catch (err) {
    logger.warn({ err: String(err) }, "[field-reps] agreement link failed");
    res.status(502).json({ ok: false, error: "agreement_unavailable", message: "The agreement could not be opened just now. Try again in a minute." });
  }
});

const CONTACT_COLS = `id::text, audience, full_name, company_name, title, email, phone_e164, notes, source, created_at,
  email_sent_at, email_opened_at, email_error, sms_due_at, sms_sent_at`;
/** What the rep sees beside each contact. */
export function contactStatus(c: { email?: string | null; email_sent_at?: unknown; email_opened_at?: unknown; email_error?: unknown; sms_sent_at?: unknown; sms_due_at?: unknown }): string {
  if (c.email_opened_at) return "Opened the information";
  if (c.sms_sent_at) return "Emailed, then texted";
  if (c.email_sent_at) return c.sms_due_at ? "Emailed - a text follows if it is not opened in 72 hours" : "Emailed";
  if (c.email_error) return "Email could not be sent - we will follow up by hand";
  return c.email ? "Saved" : "Saved - no email address, we will follow up by phone";
}

fieldPublicRouter.get("/field/me", repLimiter, requireRep, requireSigned, async (req: Request, res: Response) => {
  const rep = (req as any).rep as Rep;
  const rows = (await db().query(`SELECT ${CONTACT_COLS} FROM bi_field_contacts WHERE rep_id = $1::uuid ORDER BY created_at DESC LIMIT 500`, [rep.id])).rows;
  res.json({
    ok: true,
    rep: { code: rep.code, full_name: rep.full_name, company_name: rep.company_name },
    links: { share: repShareUrl(rep.code), share_lender: repShareUrl(rep.code, "lender"), share_broker: repShareUrl(rep.code, "broker"), book: bookUrl(rep.code) },
    counts: { total: rows.length, opened: rows.filter((r) => r.email_opened_at).length },
    contacts: rows.map((r) => ({ ...r, status: contactStatus(r) })),
  });
});

fieldPublicRouter.post("/field/contacts", repLimiter, requireRep, requireSigned, async (req: Request, res: Response) => {
  const rep = (req as any).rep as Rep;
  const c = cleanContact(req.body ?? {});
  if (!c.ok) return res.status(400).json({ ok: false, error: "invalid", message: c.message });
  const source = req.body?.source === "card" ? "card" : "manual";
  const out = await addFieldContact(db(), rep, c.value, source, followUpDeps);
  res.status(out.created ? 201 : 200).json({ ok: true, ...out });
});

// A business card photo, read into fields. The photo is not kept.
const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
export const CARD_PROMPT = `Read this business card. Reply with JSON only, using exactly these keys: full_name, company_name, title, email, phone. Use an empty string for anything not on the card. For phone, prefer the mobile or cell number, digits only with the area code. Do not guess or invent anything.`;
/** Tidies the model's answer: only the expected keys, as short strings; an email or phone that does not look like one is dropped. */
export function cardFields(raw: unknown): { full_name: string; company_name: string; title: string; email: string; phone: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string, max: number) => String(r[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const email = s("email", 200), phone = s("phone", 40);
  return { full_name: s("full_name", 120), company_name: s("company_name", 160), title: s("title", 120), email: EMAIL_RE.test(email) ? email.toLowerCase() : "", phone: normalizeE164(phone) ? phone : "" };
}
fieldPublicRouter.post("/field/scan", scanLimiter, requireRep, requireSigned, async (req: Request, res: Response) => {
  const image = String(req.body?.image ?? "");
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6_000_000) {
    return res.status(400).json({ ok: false, error: "bad_image", message: "Take the photo again." });
  }
  if (!openai) return res.status(503).json({ ok: false, error: "scan_unavailable", message: "Card reading is not available right now. Type the details in instead." });
  try {
    const r = await openai.chat.completions.create({
      model: process.env.BI_CARD_SCAN_MODEL || "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" }, max_tokens: 300,
      messages: [{ role: "user", content: [{ type: "text", text: CARD_PROMPT }, { type: "image_url", image_url: { url: image, detail: "high" } }] }],
    });
    const fields = cardFields(JSON.parse(r.choices[0]?.message?.content || "{}"));
    res.json({ ok: true, fields, found: Boolean(fields.email || fields.phone || fields.full_name) });
  } catch (err) {
    logger.warn({ err: String(err instanceof Error ? err.message : err) }, "[field-reps] card scan failed");
    res.status(502).json({ ok: false, error: "scan_failed", message: "We could not read that card. Try again in better light, or type the details in." });
  }
});

fieldPublicRouter.get("/field/rep/:code", openLimiter, async (req: Request, res: Response) => {
  const code = validRepCode(req.params.code);
  const row = code ? (await db().query(`SELECT 1 FROM bi_field_reps WHERE lower(code) = $1 AND active`, [code])).rows[0] : null;
  res.json({ ok: Boolean(row) });
});

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
fieldPublicRouter.get("/field/o/:token.gif", openLimiter, async (req: Request, res: Response) => {
  try { await markOpened(db(), String(req.params.token ?? "")); } catch (err) { logger.warn({ err: String(err) }, "[field-reps] open not recorded"); }
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" }).send(GIF);
});
fieldPublicRouter.post("/field/visit", openLimiter, async (req: Request, res: Response) => {
  try { await markOpened(db(), String(req.body?.c ?? "")); } catch (err) { logger.warn({ err: String(err) }, "[field-reps] visit not recorded"); }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ staff
export const fieldStaffRouter = Router();
fieldStaffRouter.use("/field-reps", requireStaffUser);
const actor = (req: Request): string | null => { const u = (req as any).user ?? {}; return u.id ? String(u.id) : u.userId ? String(u.userId) : u.staffUserId ? String(u.staffUserId) : null; };

fieldStaffRouter.get("/field-reps", async (_req: Request, res: Response) => {
  const rows = (await db().query(
    `SELECT r.id::text, r.code, r.full_name, r.company_name, r.email, r.phone_e164, r.active, r.created_at,
            r.agreement_required, r.agreement_group_id, r.agreement_sent_at, r.agreement_signed_at, r.agreement_error,
            count(c.id)::int AS contacts, count(c.email_opened_at)::int AS opened, max(c.created_at) AS last_contact_at
       FROM bi_field_reps r LEFT JOIN bi_field_contacts c ON c.rep_id = r.id
      GROUP BY r.id ORDER BY r.created_at DESC`)).rows;
  res.json({ ok: true, reps: rows.map((r) => ({ ...r, agreement_group_id: undefined, agreement: agreementStatus(r), page_url: repPageUrl(r.code), share_url: repShareUrl(r.code) })) });
});

fieldStaffRouter.post("/field-reps", async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const fullName = String(b.full_name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const phoneRaw = String(b.phone ?? "").trim();
  const phone = phoneRaw ? normalizeE164(phoneRaw) : null;
  if (!fullName) return res.status(400).json({ ok: false, error: "name_required", message: "Enter the rep's name." });
  if (agreementsOn() && !email) return res.status(400).json({ ok: false, error: "email_required", message: "Enter the rep's email address. Their agreement is sent there." });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "invalid_email", message: "That email address does not look right." });
  if (phoneRaw && !phone) return res.status(400).json({ ok: false, error: "invalid_phone", message: "That phone number does not look right." });
  const pin = newPin();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newRepCode();
    const taken = (await db().query(`SELECT 1 FROM bi_field_reps WHERE lower(code) = $1`, [code])).rows[0];
    if (taken) continue;
    const ins = await db().query(
      `INSERT INTO bi_field_reps (code, full_name, company_name, email, phone_e164, pin_hash, created_by, agreement_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REP_COLS}`,
      [code, fullName, String(b.company_name ?? "").trim().slice(0, 160) || null, email || null, phone, hashPin(pin), actor(req), agreementsOn()]);
    const rep = ins.rows[0] as Rep;
    // BI_SERVER_REP_AGREEMENT_v1 - issue the Introducer Agreement and email the rep their page, PIN and what to do.
    let agreement: { status: string; emailed: boolean; error?: string } = { status: "not_required", emailed: false };
    if (agreementsOn()) {
      const issued = await issueAgreement(db(), rep);
      let emailed = false;
      if (rep.email) {
        const m = welcomeMessage(rep, pin);
        try { await sendBiMarketingEmail({ to: rep.email, subject: m.subject, html: m.html, text: m.text }); emailed = true; }
        catch (err) { logger.warn({ err: String(err) }, "[field-reps] welcome email failed"); }
      }
      agreement = { status: issued.ok ? "sent" : "not_sent", emailed, ...(issued.error ? { error: issued.error } : {}) };
      if (!issued.ok) logger.warn({ repId: rep.id, error: issued.error }, "[field-reps] agreement was not issued");
    }
    return res.status(201).json({ ok: true, rep, pin, page_url: repPageUrl(code), share_url: repShareUrl(code), agreement });
  }
  res.status(500).json({ ok: false, error: "code_unavailable", message: "Try again." });
});

fieldStaffRouter.post("/field-reps/:id/pin", async (req: Request, res: Response) => {
  const pin = newPin();
  const r = await db().query(`UPDATE bi_field_reps SET pin_hash = $2, failed_pins = 0, locked_until = NULL, updated_at = now() WHERE id::text = $1 RETURNING ${REP_COLS}`, [String(req.params.id), hashPin(pin)]);
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, rep: r.rows[0], pin, page_url: repPageUrl(r.rows[0].code) });
});

// BI_SERVER_REP_AGREEMENT_v1 - send the agreement again (or for the first time, to a rep added before it existed).
fieldStaffRouter.post("/field-reps/:id/agreement", async (req: Request, res: Response) => {
  const rep = (await db().query(`SELECT ${REP_COLS}, ${AGREEMENT_COLS} FROM bi_field_reps WHERE id::text = $1`, [String(req.params.id)])).rows[0] as (Rep & AgreementRep) | undefined;
  if (!rep) return res.status(404).json({ ok: false, error: "not_found" });
  if (rep.agreement_signed_at) return res.status(409).json({ ok: false, error: "already_signed", message: "This rep has already signed." });
  if (!rep.email) return res.status(400).json({ ok: false, error: "email_required", message: "This rep has no email address." });
  await db().query(`UPDATE bi_field_reps SET agreement_required = true, updated_at = now() WHERE id = $1::uuid`, [rep.id]);
  const issued = await issueAgreement(db(), rep);
  if (!issued.ok) return res.status(502).json({ ok: false, error: "agreement_not_sent", message: "The agreement could not be sent just now (" + (issued.error ?? "unknown") + ")." });
  const url = repPageUrl(rep.code);
  try {
    await sendBiMarketingEmail({ to: rep.email, subject: "Your Boreal Risk Management agreement is ready to sign",
      text: `Hi ${rep.full_name.split(" ")[0]},\n\nYour Introducer Agreement is ready. Open your page and sign in with your PIN to sign it:\n${url}\n\nBoreal Risk Management`,
      html: `<p>Hi ${rep.full_name.split(" ")[0]},</p><p>Your Introducer Agreement is ready. Open your page and sign in with your PIN to sign it:</p><p><a href="${url}">${url}</a></p><p>Boreal Risk Management</p>` });
  } catch (err) { logger.warn({ err: String(err) }, "[field-reps] agreement email failed"); }
  res.json({ ok: true, agreement: "sent" });
});

fieldStaffRouter.patch("/field-reps/:id", async (req: Request, res: Response) => {
  if (typeof req.body?.active !== "boolean") return res.status(400).json({ ok: false, error: "active_required" });
  const r = await db().query(`UPDATE bi_field_reps SET active = $2, updated_at = now() WHERE id::text = $1 RETURNING ${REP_COLS}`, [String(req.params.id), req.body.active]);
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, rep: r.rows[0] });
});

fieldStaffRouter.get("/field-reps/:id/contacts", async (req: Request, res: Response) => {
  const rows = (await db().query(`SELECT ${CONTACT_COLS}, contact_id::text FROM bi_field_contacts WHERE rep_id::text = $1 ORDER BY created_at DESC LIMIT 1000`, [String(req.params.id)])).rows;
  res.json({ ok: true, contacts: rows.map((r) => ({ ...r, status: contactStatus(r) })) });
});

// ------------------------------------------------------------------ the 72-hour follow-up text
export function startFieldFollowUpJob(): void {
  const tick = () => { void runFollowUpSmsTick(db(), (to, body) => sendOutreachSms(to, body)).catch((err) => logger.warn({ err: String(err) }, "[field-reps] follow-up tick failed")); };
  setInterval(tick, 15 * 60 * 1000).unref();
}
