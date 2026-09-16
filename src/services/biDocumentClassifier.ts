// BI_SERVER_DOC_CLASSIFICATION_v276
// Keyword classifier over OCR text for Boreal Insurance documents. It does not
// move documents (BF's auto-retag moved correctly filed files once); it only
// records what a document looks like and whether that fits its slot.

type Group = { key: string; label: string; slots: string[]; signals: RegExp[] };

export const BI_GROUPS: Group[] = [
  { key: "loan_agreement", label: "a loan agreement", slots: ["loan_agreement", "loan_agreement_signed"],
    signals: [/loan agreement/i, /credit agreement/i, /promissory note/i, /\bborrower\b/i, /\blender\b/i, /principal amount/i, /interest rate/i, /credit facility/i] },
  { key: "personal_guarantee", label: "a personal guarantee", slots: ["personal_guarantee_copy"],
    signals: [/personal guarantee/i, /\bguarantor\b/i, /hereby (unconditionally|irrevocably) guarantee/i, /guaranteed obligations/i] },
  { key: "balance_sheet", label: "a balance sheet", slots: ["balance_sheet", "financial_statements", "annual_financials_3yr", "annual_y1", "annual_y2", "annual_y3"],
    signals: [/balance sheet/i, /total assets/i, /total liabilities/i, /shareholders'? equity/i, /retained earnings/i] },
  { key: "profit_loss", label: "a profit and loss statement", slots: ["profit_loss", "pl_12mo", "financial_statements", "annual_financials_3yr", "annual_y1", "annual_y2", "annual_y3"],
    signals: [/profit (and|&) loss/i, /income statement/i, /statement of (operations|earnings)/i, /gross profit/i, /net income/i, /operating expenses/i] },
  { key: "ar_aging", label: "an A/R aging report", slots: ["ar_aging"],
    signals: [/accounts receivable aging/i, /a\/r aging/i, /aged receivables/i, /receivable.{0,40}(over|>)\s*90/i] },
  { key: "ap_aging", label: "an A/P aging report", slots: ["ap_aging"],
    signals: [/accounts payable aging/i, /a\/p aging/i, /aged payables/i] },
  { key: "government_id", label: "government ID", slots: ["gov_id_primary", "gov_id_secondary", "proof_of_id", "id_verification"],
    signals: [/driver'?s? licen[cs]e/i, /\bpassport\b/i, /date of birth/i, /identification card/i, /\bexpiry\b|\bexpires\b/i] },
  { key: "corporate_registration", label: "corporate registration documents", slots: ["corporate_registration_docs"],
    signals: [/certificate of incorporation/i, /articles of incorporation/i, /corporate (registry|registration)/i, /registered office/i, /business number/i] },
  { key: "certificate_of_insurance", label: "a certificate of insurance", slots: ["certificate_of_insurance"],
    signals: [/certificate of insurance/i, /policy number/i, /named insured/i, /limits? of liability/i] },
  { key: "enforcement_notice", label: "an enforcement notice", slots: ["enforcement_notice"],
    signals: [/notice of intention to enforce/i, /section 244/i, /demand for (payment|repayment)/i, /enforce (its|the) security/i] },
  { key: "subcontract_agreement", label: "a subcontract agreement", slots: ["subcontract_agreement"],
    signals: [/subcontract agreement/i, /\bsubcontractor\b/i, /prime contract/i] },
  { key: "forecast", label: "a financial forecast", slots: ["financial_forecast", "forecast"],
    signals: [/forecast/i, /projections?/i, /projected (revenue|cash flow)/i] },
  { key: "founder_cv", label: "a resume", slots: ["founder_cv"],
    signals: [/curriculum vitae/i, /\bresume\b/i, /work experience/i, /\beducation\b/i] },
];

export const MISMATCH_CONFIDENCE = 0.6;

export type BiClassification = { detectedType: string | null; label: string | null; confidence: number; mismatch: boolean };

export function classifyBiDocument(text: string | null | undefined, slot: string | null | undefined): BiClassification {
  const body = String(text ?? "").slice(0, 20000);
  if (body.trim().length < 40) return { detectedType: null, label: null, confidence: 0, mismatch: false };
  let best: { group: Group; hits: number } | null = null;
  for (const group of BI_GROUPS) {
    const hits = group.signals.filter((re) => re.test(body)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { group, hits };
  }
  if (!best || best.hits < 2) return { detectedType: null, label: null, confidence: 0, mismatch: false };
  const confidence = Math.min(0.95, Math.round((0.4 + 0.15 * best.hits) * 100) / 100);
  const slotKey = String(slot ?? "").toLowerCase();
  const knownSlot = slotKey !== "" && slotKey !== "other";
  const fits = best.group.slots.includes(slotKey);
  return { detectedType: best.group.key, label: best.group.label, confidence, mismatch: knownSlot && !fits && confidence >= MISMATCH_CONFIDENCE };
}

export function labelForDetectedType(key: string | null | undefined): string | null {
  return BI_GROUPS.find((g) => g.key === key)?.label ?? null;
}
