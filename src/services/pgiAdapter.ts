// BI_BLOCK_PGI_ALIGNMENT_v1 — typed PGI client with USE_PGI_STUB toggle.
import { env } from "../platform/env";
import { logger } from "../platform/logger";

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
  const r = await fetch(`${PGI_BASE}/api/v2/score/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) {
    logger.error({ status: r.status, body: data }, "pgi_score_failed");
    throw new Error(`PGI score failed: ${r.status}`);
  }
  return data as PgiScoreResponse;
}

export async function pgiSubmit(body: PgiApplicationSubmitRequest): Promise<PgiApplicationSubmitResponse> {
  if (STUB) return { application_id: `STUB_APP_${Date.now()}`, status: "received", message: "stubbed: pending quote" };
  const r = await fetch(`${PGI_BASE}/api/v2/applications/`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) {
    logger.error({ status: r.status, body: data }, "pgi_submit_failed");
    throw new Error(`PGI submit failed: ${r.status}`);
  }
  return data;
}

export async function pgiQuote(quoteId: string): Promise<PgiQuote> {
  if (STUB) return { quote_id: quoteId, underwriter_ref: "STUB_LON_REF", annual_premium: "5000.00", rate: "2.000", coverage_amount: "250000.00", valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(), quote_status: "active" };
  const r = await fetch(`${PGI_BASE}/api/v2/quotes/${quoteId}/`, { headers: authHeaders() });
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
  return {
    guarantor_name: app.guarantorName || `${app.firstName} ${app.lastName}`.trim(),
    guarantor_email: app.guarantorEmail || app.email,
    business_name: app.businessName,
    lender_name: app.lender,
    form_data: sc,
  };
}

export async function submitToPGI(app: BIApplication, _client?: unknown) {
  const payload = buildPGIPayload(app) as PgiApplicationSubmitRequest;
  const res = await pgiSubmit(payload);
  return { externalId: res.application_id, status: res.status };
}

export async function getPGIQuote(quoteId: string) { return pgiQuote(quoteId); }
