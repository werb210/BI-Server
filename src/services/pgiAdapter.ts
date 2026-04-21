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

export function buildPGIPayload(app: BIApplication) {
  return {
    guarantor_name: app.guarantorName || `${app.firstName} ${app.lastName}`.trim(),
    guarantor_email: app.guarantorEmail || app.email,
    business_name: app.businessName,
    lender_name: app.lender || "Unknown lender",
    business: {
      name: app.businessName,
      registrationNumber: app.registrationNumber || "",
      country: "CA",
      industry: app.industry || ""
    },
    applicant: {
      firstName: app.firstName,
      lastName: app.lastName,
      email: app.email,
      phone: app.phone
    },
    loan: {
      amount: app.loanAmount,
      type: app.loanType,
      lender: app.lender || ""
    },
    guarantee: {
      coveragePercent: app.coveragePercent,
      guaranteeAmount: Math.round((app.loanAmount * app.coveragePercent) / 100)
    },
    form_data: {
      has_bankruptcy: app.scoringAnswers?.has_bankruptcy ?? false,
      years_in_business: app.scoringAnswers?.years_in_business ?? null,
      annual_revenue: app.scoringAnswers?.annual_revenue ?? null,
      prior_default: app.scoringAnswers?.prior_default ?? false,
      existing_guarantee_exposure: app.scoringAnswers?.existing_guarantee_exposure ?? null
    },
    documents: (app.documents || []).map((d) => ({
      type: d.type,
      file: d.base64
    }))
  };
}

export async function submitToPGI(app: BIApplication, axiosClient?: AxiosInstance) {
  const payload = buildPGIPayload(app);
  const client = axiosClient ?? makeClient();
  const response = await client.post("/applications/", payload);

  return {
    externalId: response.data.id as string,
    status: response.data.status as string
  };
}

export async function getPGIStatus(externalId: string, axiosClient?: AxiosInstance) {
  const client = axiosClient ?? makeClient();
  const res = await client.get(`/applications/${externalId}`);
  return res.data;
}
