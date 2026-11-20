// BI_SERVER_REP_AGREEMENT_v1 - the PGI Introducer Agreement for outside reps.
//
// Staff add a rep in the Insurance silo's Reps screen. The rep is emailed ONE thing: the agreement to sign (a private
// signing link). Only once it is signed are they emailed their welcome: their page link and their PIN (v2, 2026-11-17:
// the welcome used to go out straight away, before anything was signed). The agreement itself (wording, PDF, SignNow) lives
// in BF-Server, which holds the SignNow account; this server asks it to issue the agreement, for a signing link when
// the rep opens their page, and whether it has been signed.
//   BI_REP_AGREEMENT=off  turns the whole thing off (new reps are not asked to sign).
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../platform/jwtSecret";
import { hashPin, newPin, repPageUrl, type Q } from "./fieldReps";

export const agreementsOn = (): boolean => String(process.env.BI_REP_AGREEMENT ?? "").trim().toLowerCase() !== "off";
const bfBase = () => (process.env.BF_SERVER_URL || "https://server.boreal.financial").replace(/\/+$/, "");
const token = () => (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim();

export type AgreementRep = { id: string; code: string; full_name: string; company_name: string | null; email: string | null; phone_e164: string | null;
  agreement_required?: boolean; agreement_group_id?: string | null; agreement_invite_id?: string | null; agreement_signed_at?: unknown; agreement_sent_at?: unknown; agreement_error?: string | null };
export type AgreementBridge = {
  issue: (rep: AgreementRep) => Promise<{ groupId: string; inviteId: string; documentId: string; version: string }>;
  link: (groupId: string, inviteId: string, email: string) => Promise<{ signed: boolean; url: string | null }>;
  signed: (groupId: string) => Promise<boolean>;
};

async function bf(path: string, init?: { method?: string; body?: unknown }): Promise<any> {
  if (!token()) throw new Error("service_token_missing");
  const r = await fetch(bfBase() + "/api/service" + path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-Silo": "BI", "X-Backend-Token": token() },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(String(j?.error ?? "bf_" + r.status));
  return j;
}

export const bfAgreementBridge: AgreementBridge = {
  issue: (rep) => bf("/pgi-rep-agreement", { method: "POST", body: { repId: rep.id, fullName: rep.full_name, company: rep.company_name, email: rep.email, phone: rep.phone_e164 } }),
  link: (groupId, inviteId, email) => bf("/pgi-rep-agreement/link", { method: "POST", body: { groupId, inviteId, email } }),
  signed: async (groupId) => Boolean((await bf("/pgi-rep-agreement/" + encodeURIComponent(groupId) + "/status")).signed),
};

/** What the Reps screen shows in its Agreement column. */
export function agreementStatus(r: AgreementRep): "not_required" | "signed" | "sent" | "not_sent" {
  if (!r.agreement_required) return "not_required";
  if (r.agreement_signed_at) return "signed";
  return r.agreement_group_id ? "sent" : "not_sent";
}

/** Issues the agreement for a rep and records it. A failure is recorded, never thrown: the rep still exists. */
export async function issueAgreement(db: Q, rep: AgreementRep, bridge: AgreementBridge = bfAgreementBridge): Promise<{ ok: boolean; error?: string }> {
  if (!rep.email) { await db.query(`UPDATE bi_field_reps SET agreement_error = 'no_email', updated_at = now() WHERE id = $1::uuid`, [rep.id]); return { ok: false, error: "no_email" }; }
  try {
    const a = await bridge.issue(rep);
    await db.query(
      `UPDATE bi_field_reps SET agreement_group_id = $2, agreement_invite_id = $3, agreement_document_id = $4, agreement_version = $5,
              agreement_sent_at = now(), agreement_signed_at = NULL, agreement_error = NULL, updated_at = now() WHERE id = $1::uuid`,
      [rep.id, a.groupId, a.inviteId, a.documentId, a.version]);
    return { ok: true };
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 200);
    await db.query(`UPDATE bi_field_reps SET agreement_error = $2, updated_at = now() WHERE id = $1::uuid`, [rep.id, error]);
    return { ok: false, error };
  }
}

type Mailer = (m: { to: string; subject: string; text: string; html: string }) => Promise<unknown>;
let mailer: Mailer | null = null;
/** The route file gives this the real sender at start-up (keeps this file free of SendGrid for tests). */
export const setAgreementMailer = (m: Mailer | null): void => { mailer = m; };

/**
 * Records the signature and sends the welcome, exactly once. The PIN is made here, at signing, so it is only ever
 * emailed to someone who has signed. Returns true when this call was the one that recorded it.
 */
export async function completeSigning(db: Q, rep: AgreementRep): Promise<boolean> {
  const pin = newPin();
  const r = await db.query(
    `UPDATE bi_field_reps SET agreement_signed_at = now(), pin_hash = $2, failed_pins = 0, locked_until = NULL, pin_sent_at = now(), updated_at = now()
      WHERE id = $1::uuid AND agreement_signed_at IS NULL RETURNING id`, [rep.id, hashPin(pin)]);
  if (!r.rows[0]) return false;
  if (rep.email && mailer) {
    const m = welcomeMessage(rep, pin);
    try { await mailer({ to: rep.email, subject: m.subject, text: m.text, html: m.html }); }
    catch (err) { console.warn("[rep-agreement] welcome email failed", { repId: rep.id, message: String((err as Error)?.message ?? err) }); }
  }
  return true;
}

/** True once the rep may use their page. Asks BF-Server when our record still says unsigned, and remembers a yes. */
export async function agreementCleared(db: Q, rep: AgreementRep, bridge: AgreementBridge = bfAgreementBridge): Promise<boolean> {
  if (!agreementsOn() || !rep.agreement_required || rep.agreement_signed_at) return true;
  if (!rep.agreement_group_id) return false;
  try {
    if (!(await bridge.signed(rep.agreement_group_id))) return false;
    await completeSigning(db, rep);
    return true;
  } catch { return false; }
}

/** Every rep whose agreement is out and unsigned: ask whether it has been signed, and welcome the ones who have. */
export async function runSigningSweep(db: Q, bridge: AgreementBridge = bfAgreementBridge): Promise<number> {
  if (!agreementsOn()) return 0;
  const rows = (await db.query(
    `SELECT id::text, code, full_name, company_name, email, phone_e164, agreement_required, agreement_group_id, agreement_invite_id, agreement_signed_at
       FROM bi_field_reps
      WHERE active AND agreement_required AND agreement_signed_at IS NULL AND agreement_group_id IS NOT NULL
        AND agreement_sent_at > now() - interval '90 days' ORDER BY agreement_sent_at DESC LIMIT 50`)).rows as AgreementRep[];
  let done = 0;
  for (const rep of rows) { if (await agreementCleared(db, rep, bridge)) done += 1; }
  return done;
}

// The private signing link in the agreement email. It can only fetch that rep's signing link; it never opens their page.
const SIGN_AUD = "bi-field-rep-sign";
export function signLinkToken(repId: string): string {
  return jwt.sign({ kind: "field_rep_sign", rep_id: repId }, getJwtSecret(), { expiresIn: 60 * 24 * 60 * 60, audience: SIGN_AUD });
}
export function readSignLinkToken(token: string): string | null {
  try {
    const c = jwt.verify(token, getJwtSecret(), { audience: SIGN_AUD, algorithms: ["HS256"] }) as { kind?: string; rep_id?: string };
    return c.kind === "field_rep_sign" && c.rep_id ? String(c.rep_id) : null;
  } catch { return null; }
}
export const signPageUrl = (rep: { id: string; code: string }): string => `${repPageUrl(rep.code)}?sign=${encodeURIComponent(signLinkToken(rep.id))}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** The first email: the agreement to sign, and nothing else. No page link to use, no PIN. */
export function agreementMessage(rep: { id: string; full_name: string; code: string }): { subject: string; text: string; html: string } {
  const url = signPageUrl(rep);
  const first = rep.full_name.split(" ")[0] || rep.full_name;
  const lines = [
    `Hi ${first},`,
    "Thank you for agreeing to introduce banks, lenders and brokers to Boreal Risk Management for Personal Guarantee Insurance.",
    "Before we set you up, please read and sign our Introducer Agreement. It sets out how you are paid: 20% of the commission we receive on business from the banks, lenders and brokers you introduce, for as long as the agreement is in place. It takes about two minutes.",
    `Read and sign the agreement: ${url}`,
    "As soon as it is signed we will email your personal page and your PIN.",
    "Questions? Just reply to this email.",
    "Boreal Risk Management",
  ];
  return {
    subject: "Your Boreal Risk Management Introducer Agreement",
    text: lines.join("\n\n"),
    html: lines.map((l, i) => i === 3
      ? `<p><a href="${url}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Read and sign the agreement</a></p>`
      : `<p>${esc(l)}</p>`).join(""),
  };
}

/** The welcome, sent once the agreement is signed: their page and their PIN. */
export function welcomeMessage(rep: { full_name: string; code: string }, pin: string): { subject: string; text: string; html: string } {
  const url = repPageUrl(rep.code);
  const first = rep.full_name.split(" ")[0] || rep.full_name;
  const lines = [
    `Hi ${first},`,
    "Thank you for signing the Introducer Agreement. You are all set.",
    `Your page: ${url}`,
    `Your PIN: ${pin}`,
    "Your page gives you a link and QR code to share, a business card scanner, and a list of everyone you have introduced.",
    "Questions? Just reply to this email.",
    "Boreal Risk Management",
  ];
  return {
    subject: "Welcome - your Boreal Risk Management page and PIN",
    text: lines.join("\n\n"),
    html: lines.map((l, i) => i === 2 ? `<p>Your page: <a href="${url}">${url}</a></p>` : i === 3 ? `<p>Your PIN: <strong style="font-size:20px;letter-spacing:2px">${pin}</strong></p>` : `<p>${esc(l)}</p>`).join(""),
  };
}
