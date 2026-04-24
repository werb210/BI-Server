import axios, { AxiosInstance } from "axios";

const PGI_BASE_URL = process.env.PGI_BASE_URL || "https://api.pgicover.com/api/v2/";

function getApiKey() {
  const key = process.env.PGI_API_KEY;
  if (!key) {
    throw new Error("PGI_API_KEY is required for PGI API calls");
  }
  return key;
}

function makeClient(): AxiosInstance {
  return axios.create({
    baseURL: PGI_BASE_URL,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },
    timeout: 15000
  });
}

export interface BIApplication {
  id: string;
  businessName: string;
  registrationNumber?: string;
  industry?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanAmount: number;
  loanType: "secured" | "unsecured";
  lender?: string;
  coveragePercent: number;
  guarantorName?: string;
  guarantorEmail?: string;
  scoringAnswers?: Record<string, string | number | boolean | null>;
  documents?: {
    type: string;
    base64: string;
  }[];
}

function numOrNull(value: string | number | boolean | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function buildPGIPayload(app: BIApplication) {
  const scoring = app.scoringAnswers || {};
  const country =
    typeof scoring.country === "string" && scoring.country ? scoring.country : null;

  const required: Record<string, unknown> = {
    country,
    naics_code: typeof scoring.naics_code === "string" ? scoring.naics_code : null,
    formation_date: typeof scoring.formation_date === "string" ? scoring.formation_date : null,
    loan_amount: numOrNull(scoring.loan_amount) ?? app.loanAmount ?? null,
    pgi_limit: numOrNull(scoring.pgi_limit),
    annual_revenue: numOrNull(scoring.annual_revenue),
    ebitda: numOrNull(scoring.ebitda),
    total_debt: numOrNull(scoring.total_debt),
    monthly_debt_service: numOrNull(scoring.monthly_debt_service),
    collateral_value: numOrNull(scoring.collateral_value),
    enterprise_value: numOrNull(scoring.enterprise_value)
  };

  const missing = Object.entries(required)
    .filter(([, v]) => v === null || v === undefined || v === "")
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(`Missing required form_data fields: ${missing.join(", ")}`);
  }

  return {
    guarantor_name: app.guarantorName || `${app.firstName} ${app.lastName}`.trim(),
    guarantor_email: app.guarantorEmail || app.email,
    business_name: app.businessName,
    lender_name: app.lender || "Unknown lender",
    form_data: {
      country: required.country,
      naics_code: required.naics_code,
      formation_date: required.formation_date,
      loan_amount: required.loan_amount,
      pgi_limit: required.pgi_limit,
      annual_revenue: required.annual_revenue,
      ebitda: required.ebitda,
      total_debt: required.total_debt,
      monthly_debt_service: required.monthly_debt_service,
      collateral_value: required.collateral_value,
      enterprise_value: required.enterprise_value,
      bankruptcy_history: Boolean(
        scoring.bankruptcy_history ?? scoring.has_bankruptcy ?? false
      ),
      insolvency_history: Boolean(scoring.insolvency_history ?? false),
      judgment_history: Boolean(scoring.judgment_history ?? scoring.prior_default ?? false)
    }
  };
}

export async function submitToPGI(app: BIApplication, axiosClient?: AxiosInstance) {
  const payload = buildPGIPayload(app);
  const client = axiosClient ?? makeClient();
  const response = await client.post("/applications/", payload);

  return {
    externalId: (response.data.application_id ?? response.data.id) as string,
    status: response.data.status as string
  };
}

export async function getPGIQuote(quoteId: string, axiosClient?: AxiosInstance) {
  const client = axiosClient ?? makeClient();
  const res = await client.get(`/quotes/${quoteId}/`);
  return res.data;
}

export async function scorePGI(payload: Record<string, unknown>, axiosClient?: AxiosInstance) {
  const client = axiosClient ?? makeClient();
  const res = await client.post("/score/", payload);
  return res.data;
}
