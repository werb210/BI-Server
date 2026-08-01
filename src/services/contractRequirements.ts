// BI_CLIENT_FOUNDATION_v1 - deterministic extraction of insurance requirements
// from a subcontract. Every result is a candidate for client confirmation.

export type ExtractedRequirement = {
  coverageCode: string;
  extractedLimit: number | null;
  limitBasis: string | null;
  clauseText: string;
  confidence: number;
};

type Rule = { code: string; patterns: RegExp[]; weight: number };

// Ordered most specific first so named coverages and bonds win.
const RULES: Rule[] = [
  { code: "cpl", patterns: [/contractor'?s?\s+pollution/i, /\bCPL\b/, /pollution\s+liability/i], weight: 0.9 },
  { code: "surety_performance", patterns: [/performance\s+bond/i, /CCDC\s*221/i, /A312/i], weight: 0.95 },
  { code: "surety_payment", patterns: [/labou?r\s+and\s+material\s+payment\s+bond/i, /payment\s+bond/i, /CCDC\s*222/i], weight: 0.95 },
  { code: "surety_bid", patterns: [/bid\s+bond/i, /CCDC\s*220/i, /A310/i], weight: 0.95 },
  { code: "surety_maintenance", patterns: [/maintenance\s+bond/i, /warranty\s+bond/i], weight: 0.9 },
  { code: "cgl", patterns: [/commercial\s+general\s+liability/i, /\bCGL\b/, /general\s+liability/i], weight: 0.95 },
  { code: "contractor_equipment", patterns: [/contractor'?s?\s+equipment/i, /tools?\s+and\s+equipment/i, /equipment\s+floater/i], weight: 0.85 },
  { code: "eo", patterns: [/errors\s+and\s+omissions/i, /\bE&O\b/i, /professional\s+liability/i, /professional\s+indemnity/i], weight: 0.9 },
  { code: "cyber", patterns: [/cyber\s+liability/i, /\bcyber\b/i], weight: 0.8 },
  { code: "do", patterns: [/directors?\s+and\s+officers?/i, /\bD&O\b/i], weight: 0.85 },
  { code: "builders_risk", patterns: [/builder'?s?\s+risk/i, /course\s+of\s+construction/i, /\bCOC\b/], weight: 0.9 },
];

export function splitClauses(text: string): string[] {
  return String(text || "")
    .split(/(?:\r?\n)+|(?<=[.;])\s+/)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter((clause) => clause.length > 12);
}

// Return the largest amount because understating a required limit is dangerous.
export function parseLimit(clause: string): number | null {
  const found: number[] = [];
  for (const match of clause.matchAll(/\$?\s?([\d][\d,]*(?:\.\d+)?)\s*(million|mil\b|m\b)/gi)) {
    const amount = Number(String(match[1]).replace(/,/g, ""));
    if (Number.isFinite(amount)) found.push(amount * 1_000_000);
  }
  for (const match of clause.matchAll(/\$\s?([\d][\d,]{2,}(?:\.\d{2})?)/g)) {
    const amount = Number(String(match[1]).replace(/,/g, ""));
    if (Number.isFinite(amount)) found.push(amount);
  }
  return found.length === 0 ? null : Math.max(...found);
}

export function parseBasis(clause: string): string | null {
  if (/per\s+occurrence/i.test(clause)) return "per occurrence";
  if (/aggregate/i.test(clause)) return "aggregate";
  if (/per\s+claim/i.test(clause)) return "per claim";
  if (/inclusive/i.test(clause)) return "inclusive";
  return null;
}

export function extractRequirements(text: string): ExtractedRequirement[] {
  const best = new Map<string, ExtractedRequirement>();
  for (const clause of splitClauses(text)) {
    for (const rule of RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(clause))) continue;
      const limit = parseLimit(clause);
      const confidence = Math.min(0.99, limit !== null ? rule.weight : rule.weight - 0.25);
      const found = {
        coverageCode: rule.code,
        extractedLimit: limit,
        limitBasis: parseBasis(clause),
        clauseText: clause.slice(0, 1000),
        confidence: Number(confidence.toFixed(2)),
      };
      const existing = best.get(rule.code);
      if (!existing || found.confidence > existing.confidence) best.set(rule.code, found);
      break;
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}
