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
  EMAIL_RE, MAX_PIN_TRIES, PIN_LOCK_MINUTES, addFieldContact, bookUrl, cleanContact, hashPin, markOpened, newPin, newRepCode, pinMatches,
  readRepToken, repPageUrl, repShareUrl, runFollowUpSmsTick, signRepToken, validRepCode, type CleanContact, type FollowUpDeps, type Q, type Rep,
} from "../services/fieldReps";

const db = () => pool as unknown as Q;
const REP_COLS = "id::text, code, full_name, company_name, email, phone_e164, active";

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

async function requireRep(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
  const repId = m ? readRepToken(m[1]!) : null;
  const rep = repId ? ((await db().query(`SELECT ${REP_COLS} FROM bi_field_reps WHERE id = $1::uuid AND active`, [repId])).rows[0] as Rep | undefined) : undefined;
  if (!rep) return res.status(401).json({ ok: false, error: "sign_in_again", message: "Enter your PIN again." });
  (req as any).rep = rep;
  next();
}

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

fieldPublicRouter.get("/field/me", repLimiter, requireRep, async (req: Request, res: Response) => {
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

fieldPublicRouter.post("/field/contacts", repLimiter, requireRep, async (req: Request, res: Response) => {
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
fieldPublicRouter.post("/field/scan", scanLimiter, requireRep, async (req: Request, res: Response) => {
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
            count(c.id)::int AS contacts, count(c.email_opened_at)::int AS opened, max(c.created_at) AS last_contact_at
       FROM bi_field_reps r LEFT JOIN bi_field_contacts c ON c.rep_id = r.id
      GROUP BY r.id ORDER BY r.created_at DESC`)).rows;
  res.json({ ok: true, reps: rows.map((r) => ({ ...r, page_url: repPageUrl(r.code), share_url: repShareUrl(r.code) })) });
});

fieldStaffRouter.post("/field-reps", async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const fullName = String(b.full_name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const phoneRaw = String(b.phone ?? "").trim();
  const phone = phoneRaw ? normalizeE164(phoneRaw) : null;
  if (!fullName) return res.status(400).json({ ok: false, error: "name_required", message: "Enter the rep's name." });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "invalid_email", message: "That email address does not look right." });
  if (phoneRaw && !phone) return res.status(400).json({ ok: false, error: "invalid_phone", message: "That phone number does not look right." });
  const pin = newPin();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newRepCode();
    const taken = (await db().query(`SELECT 1 FROM bi_field_reps WHERE lower(code) = $1`, [code])).rows[0];
    if (taken) continue;
    const ins = await db().query(
      `INSERT INTO bi_field_reps (code, full_name, company_name, email, phone_e164, pin_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${REP_COLS}`,
      [code, fullName, String(b.company_name ?? "").trim().slice(0, 160) || null, email || null, phone, hashPin(pin), actor(req)]);
    return res.status(201).json({ ok: true, rep: ins.rows[0], pin, page_url: repPageUrl(code), share_url: repShareUrl(code) });
  }
  res.status(500).json({ ok: false, error: "code_unavailable", message: "Try again." });
});

fieldStaffRouter.post("/field-reps/:id/pin", async (req: Request, res: Response) => {
  const pin = newPin();
  const r = await db().query(`UPDATE bi_field_reps SET pin_hash = $2, failed_pins = 0, locked_until = NULL, updated_at = now() WHERE id::text = $1 RETURNING ${REP_COLS}`, [String(req.params.id), hashPin(pin)]);
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, rep: r.rows[0], pin, page_url: repPageUrl(r.rows[0].code) });
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
