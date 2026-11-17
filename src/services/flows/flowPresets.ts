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
const ul = (...items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const a = (label: string, href = "{{link}}") => `<a href="${href}">${label}</a>`;
const hi = "Hi {{first_name}},";
const sign = "Andrew";

type Terms = { share: string; max: string; rate: string; loan: string; insured: string; premium: string; sba: boolean };
const US: Terms = { share: "90%", max: "$5,000,000", rate: "2%", loan: "$2,000,000", insured: "$1,800,000", premium: "$36,000", sba: true };
const CA: Terms = { share: "80%", max: "$1,000,000", rate: "2.7%", loan: "$1,000,000", insured: "$800,000", premium: "$21,600", sba: false };

function lenderEmails(t: Terms): Record<FlowKey, FlowEmail> {
  return {
    e1: { subject: "Insurance on your borrower's personal guarantee", body: p(hi,
      "When a deal at {{company}} depends on a personal guarantee, the guarantee is only as good as the guarantor's ability to pay.",
      "Personal Guarantee Insurance changes that. The business owner buys a policy that pays toward the guarantee if it is called. You keep the guarantee, and there is insured money behind it.",
      ul(`Covers up to ${t.share} of the guaranteed amount, up to ${t.max}`, `Paid for by the borrower, about ${t.rate} of the insured amount a year`, "No cost to the lender"),
      a("See how it works for lenders"), sign) },
    n2: { subject: "A stronger guarantee on your next file", body: p(hi,
      "One line: your borrowers can insure the personal guarantee they give you, so a called guarantee is backed by an insurer and not only by the owner's own assets.",
      `It costs {{company}} nothing. ${a("Two-minute overview")}`, sign) },
    n3: { subject: "For the deals that stall at the guarantee", body: p(hi,
      "Some owners walk away when they see the personal guarantee. An insured guarantee gets more of them to sign, because their home is no longer the only thing standing behind the loan.",
      ul("Works on secured and unsecured loans", ...(t.sba ? ["SBA loans are eligible"] : []), "You submit the file, or the borrower applies directly"),
      a("See if a file qualifies"), sign) },
    n4: { subject: "Last note from me", body: p(hi,
      "I will stop here. If insured personal guarantees are ever useful at {{company}}, the overview is one click away and I am happy to walk your credit team through it.",
      a("Overview for lenders"), sign) },
    o1: { subject: "How lenders use Personal Guarantee Insurance", body: p(hi,
      "A little more detail on how this fits into a file at {{company}}:",
      ol("You issue the term sheet as usual, with the personal guarantee.", "The borrower applies online and gets a score.", "The policy is issued against the guarantee on your loan.", "If the guarantee is called, the policy pays toward it, up to the insured amount."),
      "Lenders use it to approve files that are close, and to keep borrowers who would otherwise refuse to sign.",
      a("Full details for lenders"), sign) },
    o2: { subject: "A quick example", body: p(hi,
      `A typical file: a ${t.loan} loan with a full personal guarantee. The owner insures ${t.insured} of it for roughly ${t.premium} a year. If the business fails and the guarantee is called, the policy pays toward the shortfall.`,
      "If you have a file like that on your desk now, send it over and I will tell you whether it fits.",
      a("Send a file or ask a question"), sign) },
    c1: { subject: "Happy to walk you through it", body: p(hi,
      "Thanks for taking a look. I would like to give you the short version by phone and answer anything your credit team will ask.",
      a("Pick a time that suits you", "{{booking_link}}"),
      "If it is easier, just reply with a good number. Otherwise I will give you a call in the next day or two.", sign) },
  };
}

function brokerEmails(t: Terms): Record<FlowKey, FlowEmail> {
  return {
    e1: { subject: "For clients who hesitate at the personal guarantee", body: p(hi,
      "Every commercial broker has lost a deal at the same point: the lender wants a personal guarantee and the owner will not put the house on the line.",
      "Personal Guarantee Insurance is the answer to that conversation. Your client insures the guarantee, so if it is ever called, the policy pays toward it.",
      ul(`Covers up to ${t.share} of the guarantee, up to ${t.max}`, "Works with the lender your client already has", "You earn a referral fee on every client or lender you introduce"),
      a("See how brokers use it"), sign) },
    n2: { subject: "One more tool for your next financing", body: p(hi,
      "Short version: your clients can insure the personal guarantee on a business loan. It makes owners more willing to sign and lenders more comfortable approving.",
      a("Two-minute overview"), sign) },
    n3: { subject: "Protect the client, keep the deal", body: p(hi, "Three reasons brokers bring this to clients:",
      ul("It protects the owner's personal assets if the business fails", "It can be added to a loan you have already placed", "You are paid a referral fee, and it sets you apart from the broker who only shops a rate"),
      a("See if a client qualifies"), sign) },
    n4: { subject: "Last note from me", body: p(hi,
      "I will leave it here. If a client ever balks at a personal guarantee, keep this link handy and call me; I can tell you whether the file fits.",
      a("Overview for brokers"), sign) },
    o1: { subject: "How it works on a real file", body: p(hi, "Here is the whole process on one of your deals:",
      ol("You place the loan as usual.", "You send the client our application link, or we send it for you.", "They get a score and upload a few financial statements.", "The policy starts with the loan. You stay the client's broker throughout."),
      a("Full details for brokers"), sign) },
    o2: { subject: "A quick example", body: p(hi,
      `An owner borrowing ${t.loan} with a full personal guarantee can insure ${t.insured} of it for roughly ${t.premium} a year. For most owners that is an easy decision next to the risk of losing the family home.`,
      "If you have a client in that position today, send me the outline and I will tell you whether it qualifies.",
      a("Send a file or ask a question"), sign) },
    c1: { subject: "Happy to walk you through it", body: p(hi,
      "Thanks for taking a look. I would like to show you how brokers are using this and answer your questions in fifteen minutes.",
      a("Pick a time that suits you", "{{booking_link}}"),
      "Or reply with a good number. Otherwise I will give you a call in the next day or two.", sign) },
  };
}

export const FLOW_PRESETS: FlowPreset[] = [
  { key: "lender_us", name: "Lenders - United States", audience: "lender", market: "US", link_url: "https://www.boreal.insure/us-lenders", booking_url: TEAM_BOOKING, emails: lenderEmails(US) },
  { key: "lender_ca", name: "Lenders - Canada", audience: "lender", market: "CA", link_url: "https://www.boreal.insure/ca", booking_url: TEAM_BOOKING, emails: lenderEmails(CA) },
  { key: "broker_ca", name: "Brokers - Canada", audience: "broker", market: "CA", link_url: "https://www.boreal.insure/ca", booking_url: TEAM_BOOKING, emails: brokerEmails(CA) },
  { key: "broker_us", name: "Brokers - United States", audience: "broker", market: "US", link_url: "https://www.boreal.insure/us-brokers", booking_url: TEAM_BOOKING, emails: brokerEmails(US) },
];
export const presetByKey = (key: unknown): FlowPreset | null => FLOW_PRESETS.find((x) => x.key === String(key ?? "")) ?? null;
