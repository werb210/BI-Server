import { env } from "../platform/env";
import { logger } from "../platform/logger";

// BI_BLOCK_PGI_ALIGNMENT_v1 — typed PGI client with USE_PGI_STUB toggle.

// v343: Retry-After aware fetch — single retry on 429/503 honoring the
// header. Returns the second Response. Falls back to immediate throw
// if header is absent or unparseable.
async function fetchWithRetryAfter(url: string, init: RequestInit): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 429 && first.status !== 503) return first;
  const ra = first.headers.get("Retry-After");
  if (!ra) return first;
  let waitMs = 0;
  const asNum = Number(ra);
  if (Number.isFinite(asNum) && asNum > 0) {
    waitMs = Math.min(asNum * 1000, 60_000);
  } else {
    const t = Date.parse(ra);
    if (Number.isFinite(t)) waitMs = Math.max(0, Math.min(t - Date.now(), 60_000));
  }
  if (waitMs <= 0) return first;
  await new Promise((r) => setTimeout(r, waitMs));
  return fetch(url, init);
}

const PGI_BASE = env.PGI_BASE_URL || "https://api.pgicover.com";
const STUB = String(env.USE_PGI_STUB || "true").toLowerCase() === "true";

export type PgiScoreRequest = {
  country: "CA" | "US";
  naics_code: string;
  formation_date: string;
  loan_amount: number;
  pgi_limit: number;
  annual_revenue: number;
  ebitda: number;
  total_debt: number;
  monthly_debt_service: number;
  collateral_value: number;
  enterprise_value: number;
};

export type PgiScoreResponse =
  | { score_id: string; score: number; decision: "approve"; country: string; naics_code: string; created_at: string }
  | { score_id: string; decision: "decline"; reason: string; country: string; naics_code: string; created_at: string };

export type PgiApplicationSubmitRequest = {
  guarantor_name: string;
  guarantor_email: string;
  business_name: string;
  lender_name?: string;
  form_data: PgiScoreRequest & {
    bankruptcy_history: boolean;
    insolvency_history: boolean;
    judgment_history: boolean;
    [extra: string]: unknown;
  };
};

export type PgiApplicationSubmitResponse = { application_id: string; status: string; message?: string };
export type PgiQuote = { quote_id: string; underwriter_ref: string; annual_premium: string; rate: string; coverage_amount: string; valid_until: string; quote_status: "active" | "expired" | "bound" };

function authHeaders() {
  if (!env.PGI_API_KEY) throw new Error("PGI_API_KEY missing");
  return { Authorization: `Bearer ${env.PGI_API_KEY}`, "Content-Type": "application/json" };
}

export async function pgiScore(body: PgiScoreRequest): Promise<PgiScoreResponse> {
  if (STUB) {
    if (body.naics_code === "721110") {
      return { score_id: `STUB_DECLINE_${Date.now()}`, decision: "decline", reason: "NAICS code not approved for coverage.", country: body.country, naics_code: body.naics_code, created_at: new Date().toISOString() };
    }
    return { score_id: `STUB_APPROVE_${Date.now()}`, score: 78, decision: "approve", country: body.country, naics_code: body.naics_code, created_at: new Date().toISOString() };
  }
  const r = await fetchWithRetryAfter(`${PGI_BASE}/api/v2/score/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) {
    logger.error({ status: r.status, body: data }, "pgi_score_failed");
    throw new Error(`PGI score failed: ${r.status}`);
  }
  return data as PgiScoreResponse;
}

export async function pgiSubmit(body: PgiApplicationSubmitRequest): Promise<PgiApplicationSubmitResponse> {
  if (STUB) return { application_id: `STUB_APP_${Date.now()}`, status: "received", message: "stubbed: pending quote" };
  const r = await fetchWithRetryAfter(`${PGI_BASE}/api/v2/applications/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) {
    logger.error({ status: r.status, body: data }, "pgi_submit_failed");
    throw new Error(`PGI submit failed: ${r.status}`);
  }
  return data;
}

export async function pgiQuote(quoteId: string): Promise<PgiQuote> {
  if (STUB) return { quote_id: quoteId, underwriter_ref: "STUB_LON_REF", annual_premium: "5000.00", rate: "2.000", coverage_amount: "250000.00", valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(), quote_status: "active" };
  const r = await fetchWithRetryAfter(`${PGI_BASE}/api/v2/quotes/${quoteId}/`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`PGI quote fetch failed: ${r.status}`);
  return (await r.json()) as PgiQuote;
}


// Backward-compatible exports
export interface BIApplication {
  id: string; businessName: string; registrationNumber?: string; industry?: string; firstName: string; lastName: string; email: string; phone: string;
  loanAmount: number; loanType: "secured" | "unsecured"; lender?: string; coveragePercent: number;
  guarantorName?: string; guarantorEmail?: string; scoringAnswers?: Record<string, string | number | boolean | null>; documents?: { type: string; base64: string }[];
}

export function buildPGIPayload(app: BIApplication) {
  const sc = app.scoringAnswers || {};
  // v331: scoringAnswers alone is missing the top-level economic fields
  // the carrier needs. Merge loanAmount, loanType, coveragePercent, and
  // a computed pgi_limit (= loan_amount * coveragePercent/100) into
  // form_data. scoringAnswers wins on key conflicts so caller-supplied
  // overrides still take precedence.
  const loanAmount = app.loanAmount;
  const coveragePct = app.coveragePercent;
  const pgiLimit = Math.round(loanAmount * (coveragePct / 100));
  return {
    guarantor_name: app.guarantorName || `${app.firstName} ${app.lastName}`.trim(),
    guarantor_email: app.guarantorEmail || app.email,
    business_name: app.businessName,
    lender_name: app.lender,
    form_data: {
      loan_amount: loanAmount,
      loan_type: app.loanType,
      coverage_percent: coveragePct,
      pgi_limit: pgiLimit,
      ...sc,
    },
  };
}

export async function submitToPGI(app: BIApplication, client?: { post: (path: string, payload: PgiApplicationSubmitRequest) => Promise<{ data: { id: string; status: string } }> }) {
  const payload = buildPGIPayload(app) as unknown as PgiApplicationSubmitRequest;
  if (client) {
    const res = await client.post("/applications/", payload);
    return { externalId: res.data.id, status: res.data.status };
  }
  const res = await pgiSubmit(payload);
  return { externalId: res.application_id, status: res.status };
}

export async function getPGIQuote(quoteId: string) { return pgiQuote(quoteId); }


// BI_SERVER_BLOCK_v349_PGI_ADAPTER_V2_v1
import type { CarrierPayloadV2 } from "./pgiCarrierMapper";

export class PgiCarrierValidationError extends Error {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(`PGI 400: ${JSON.stringify(errors)}`);
    this.name = "PgiCarrierValidationError";
    this.errors = errors;
  }
}

export async function pgiSubmitV2(payload: CarrierPayloadV2): Promise<{ application_id: string; status: string; message?: string }> {
  const base = process.env.PGI_API_BASE || "https://api.pgicover.com";
  const key = process.env.PGI_API_KEY || "";
  const url = `${base.replace(/\/$/, "")}/api/v2/applications/`;
  if (process.env.USE_PGI_STUB === "true") return { application_id: `STUB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, status: "received", message: "stub" };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify(payload) });
  if (res.status === 400) { const body = (await res.json().catch(() => ({}))) as { errors?: Record<string, string> }; throw new PgiCarrierValidationError(body.errors ?? { _root: "carrier returned 400 with no errors dict" }); }
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`pgi_submit_failed status=${res.status} body=${text.slice(0, 500)}`); }
  return (await res.json()) as { application_id: string; status: string; message?: string };
}
