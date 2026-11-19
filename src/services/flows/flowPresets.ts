// BI_SERVER_EMAIL_FLOWS_v1 - the starting wording for each flow. Staff can change every email before a flow starts.
// Merge fields: {{first_name}}, {{company}}, {{link}} (the page for this audience), {{booking_link}} (the team calendar).
import type { FlowKey } from "./flowEngine";

export type FlowEmail = { subject: string; body: string };
export type FlowPreset = {
  key: string; name: string; audience: "lender" | "broker"; market: "US" | "CA";
  link_url: string; booking_url: string; emails: Record<FlowKey, FlowEmail>;
};

const TEAM_BOOKING = "https://www.boreal.financial/book-pgi";
const p = (...lines: string[]) => lines.map((l) => (l.startsWith("<") ? l : `<p>${l}</p>`)).join("\n");
const a = (label: string, href = "{{link}}") => `<a href="${href}">${label}</a>`;
const hi = "Hi {{first_name}},";
const sign = "Andrew";

// BI_SERVER_PGI_COMPLIANCE_v1 (2026-11-19) - rewritten after PGI Canada Ltd.'s written notice. Introductions only:
// name the licensed broker (PGI Canada Ltd.; PGI America Ltd. for the US, not yet available), the one authorized
// Canadian rate line, nothing else about the program. Lenders are only asked to make borrowers aware; the policy is
// never tied to the credit decision. No eligibility rules, limits, shares, insurer brand, claims process, "pays the
// lender", asset protection, lender benefits, negotiating leverage or referral fees. Brand: Boreal Risk Management.
type Mkt = { broker: string; live: boolean; rateLine: string; disclose: string };
const CA_M: Mkt = {
  broker: "PGI Canada Ltd.", live: true, rateLine: "Rates start as low as 1.8% of the limit of insurance.",
  disclose: "Boreal Risk Management is a referral partner of PGI Canada Ltd. and is not a licensed insurance broker. The offer, program details and conditions come from PGI Canada Ltd. Not available to Quebec residents.",
};
const US_M: Mkt = {
  broker: "PGI America Ltd.", live: false, rateLine: "",
  disclose: "Boreal Risk Management makes introductions only and is not a licensed insurance producer or broker. In the United States, Personal Guarantee Insurance will be arranged by PGI America Ltd. and is not yet available.",
};
const small = (t: string) => `<p style="font-size:12px;color:#64748b">${t}</p>`;
const WHAT = "Personal Guarantee Insurance covers a personal guarantee given to a recognised lender on a business loan, and can cap the owner's personal loss if the business becomes insolvent.";

function lenderEmails(m: Mkt): Record<FlowKey, FlowEmail> {
  const avail = m.live ? `It is arranged and administered by ${m.broker}, a licensed insurance broker. ${m.rateLine}` : `In the United States it will be arranged by ${m.broker} It is not available yet, and program details have not been published.`;
  const cta = m.live ? "See the details from PGI" : "Be told when it is available";
  return {
    e1: { subject: "An option your borrowers may not know about", body: p(hi,
      "Business owners who sign a personal guarantee on a loan from {{company}} often do not know the guarantee can be insured.",
      WHAT, avail,
      "All we would ask of {{company}} is to let borrowers know the option exists. It is the borrower's choice and is never part of a credit decision.",
      a(cta), sign, small(m.disclose)) },
    n2: { subject: "Personal guarantees can be insured", body: p(hi,
      `One line: business owners can insure the personal guarantee they sign. ${m.live ? `${m.broker} arranges it.` : `In the US, ${m.broker} will arrange it once the program is available.`}`,
      a(cta), sign, small(m.disclose)) },
    n3: { subject: "Letting borrowers know", body: p(hi,
      "If a borrower asks whether a personal guarantee can be insured, the answer is yes. The lender's only part is to make borrowers aware the option exists; it is optional and separate from your credit decision.",
      a(cta), sign, small(m.disclose)) },
    n4: { subject: "Last note from me", body: p(hi,
      "I will stop here. If it is ever useful to point a borrower to Personal Guarantee Insurance, the link is below.",
      a(cta), sign, small(m.disclose)) },
    o1: { subject: "Where the details come from", body: p(hi,
      `Thanks for opening my note. The offer, the program details and the conditions all come from ${m.broker}${m.live ? ", the licensed broker" : ""}, not from us. We make introductions only.`,
      a(cta), sign, small(m.disclose)) },
    o2: { subject: "What it is, in one paragraph", body: p(hi,
      `${WHAT} It does not prevent default, insolvency or lender enforcement, and it does not protect all of an owner's assets.`,
      a(cta), sign, small(m.disclose)) },
    c1: { subject: "Happy to talk", body: p(hi,
      "Thanks for taking a look. If a short call would help, pick a time below or reply with a good number.",
      a("Pick a time that suits you", "{{booking_link}}"), sign, small(m.disclose)) },
  };
}

function brokerEmails(m: Mkt): Record<FlowKey, FlowEmail> {
  const avail = m.live ? `It is arranged and administered by ${m.broker}, a licensed insurance broker. ${m.rateLine}` : `In the United States it will be arranged by ${m.broker} It is not available yet, and program details have not been published.`;
  const cta = m.live ? "See the details from PGI" : "Be told when it is available";
  return {
    e1: { subject: "For clients asked to sign a personal guarantee", body: p(hi,
      "Many of your clients are asked to sign a personal guarantee, and most do not know it can be insured.",
      WHAT, avail,
      "You can let clients know the option exists. You never sell, quote or negotiate insurance: the details come from PGI. It is optional for the client and never a condition of a loan.",
      a(cta), sign, small(m.disclose)) },
    n2: { subject: "Personal guarantees can be insured", body: p(hi,
      `Short version: your clients can insure the personal guarantee on a business loan. ${m.live ? `${m.broker} arranges it.` : `In the US, ${m.broker} will arrange it once the program is available.`}`,
      a(cta), sign, small(m.disclose)) },
    n3: { subject: "Something most owners have not heard of", body: p(hi,
      "Most business owners do not know a personal guarantee can be insured. You can be the one who tells them the option exists, and point them to PGI for the details.",
      a(cta), sign, small(m.disclose)) },
    n4: { subject: "Last note from me", body: p(hi,
      "I will leave it here. If a client ever asks whether a personal guarantee can be insured, the link is below.",
      a(cta), sign, small(m.disclose)) },
    o1: { subject: "Where the details come from", body: p(hi,
      `Thanks for opening my note. The offer, the program details and the conditions all come from ${m.broker}${m.live ? ", the licensed broker" : ""}, not from us or from you.`,
      a(cta), sign, small(m.disclose)) },
    o2: { subject: "What it is, in one paragraph", body: p(hi,
      `${WHAT} It does not prevent default, insolvency or lender enforcement, and it does not protect all of an owner's assets.`,
      a(cta), sign, small(m.disclose)) },
    c1: { subject: "Happy to talk", body: p(hi,
      "Thanks for taking a look. If a short call would help, pick a time below or reply with a good number.",
      a("Pick a time that suits you", "{{booking_link}}"), sign, small(m.disclose)) },
  };
}

const PGI_LINK = "https://pgicover.com/boreal";
export const FLOW_PRESETS: FlowPreset[] = [
  { key: "lender_us", name: "Lenders - United States", audience: "lender", market: "US", link_url: "https://www.boreal.insure/us-lenders", booking_url: TEAM_BOOKING, emails: lenderEmails(US_M) },
  { key: "lender_ca", name: "Lenders - Canada", audience: "lender", market: "CA", link_url: PGI_LINK, booking_url: TEAM_BOOKING, emails: lenderEmails(CA_M) },
  { key: "broker_ca", name: "Brokers - Canada", audience: "broker", market: "CA", link_url: PGI_LINK, booking_url: TEAM_BOOKING, emails: brokerEmails(CA_M) },
  { key: "broker_us", name: "Brokers - United States", audience: "broker", market: "US", link_url: "https://www.boreal.insure/us-brokers", booking_url: TEAM_BOOKING, emails: brokerEmails(US_M) },
];
export const presetByKey = (key: unknown): FlowPreset | null => FLOW_PRESETS.find((x) => x.key === String(key ?? "")) ?? null;
