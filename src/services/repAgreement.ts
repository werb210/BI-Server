// BI_SERVER_REP_AGREEMENT_v1 - the PGI Introducer Agreement for outside reps.
//
// Staff add a rep in the Insurance silo's Reps screen. The rep is emailed their page link, their PIN and a request
// to sign the agreement; the page stays locked until it is signed. The agreement itself (wording, PDF, SignNow) lives
// in BF-Server, which holds the SignNow account; this server asks it to issue the agreement, for a signing link when
// the rep opens their page, and whether it has been signed.
//   BI_REP_AGREEMENT=off  turns the whole thing off (new reps are not asked to sign).
import { repPageUrl, type Q } from "./fieldReps";

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

/** True once the rep may use their page. Asks BF-Server when our record still says unsigned, and remembers a yes. */
export async function agreementCleared(db: Q, rep: AgreementRep, bridge: AgreementBridge = bfAgreementBridge): Promise<boolean> {
  if (!agreementsOn() || !rep.agreement_required || rep.agreement_signed_at) return true;
  if (!rep.agreement_group_id) return false;
  try {
    if (!(await bridge.signed(rep.agreement_group_id))) return false;
    await db.query(`UPDATE bi_field_reps SET agreement_signed_at = now(), updated_at = now() WHERE id = $1::uuid AND agreement_signed_at IS NULL`, [rep.id]);
    return true;
  } catch { return false; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** The one email a new rep gets: their page, their PIN, and the agreement to sign first. */
export function welcomeMessage(rep: { full_name: string; code: string }, pin: string): { subject: string; text: string; html: string } {
  const url = repPageUrl(rep.code);
  const first = rep.full_name.split(" ")[0] || rep.full_name;
  const lines = [
    `Hi ${first},`,
    "Welcome. You have been set up to introduce banks, lenders and brokers to Boreal Risk Management for Personal Guarantee Insurance.",
    `Your page: ${url}`,
    `Your PIN: ${pin}`,
    "The first time you open your page you will be asked to sign our Introducer Agreement. It sets out how you are paid: 20% of the commission we receive on business from the banks and brokers you introduce. Your page opens as soon as it is signed.",
    "Your page gives you a link and QR code to share, a business card scanner, and a list of everyone you have introduced.",
    "Questions? Just reply to this email.",
    "Boreal Risk Management",
  ];
  return {
    subject: "Your Boreal Risk Management page and agreement",
    text: lines.join("\n\n"),
    html: lines.map((l, i) => i === 2 ? `<p>Your page: <a href="${url}">${url}</a></p>` : i === 3 ? `<p>Your PIN: <strong style="font-size:20px;letter-spacing:2px">${pin}</strong></p>` : `<p>${esc(l)}</p>`).join(""),
  };
}
