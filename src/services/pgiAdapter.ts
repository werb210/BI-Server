import axios, { AxiosInstance } from "axios";

const PGI_BASE_URL = process.env.PGI_BASE_URL || "https://api.pgicover.com";
const PGI_API_KEY = process.env.PGI_API_KEY || "";

const client = axios.create({
  baseURL: PGI_BASE_URL,
  headers: {
    Authorization: `Bearer ${PGI_API_KEY}`,
    "Content-Type": "application/json"
  },
  timeout: 15000
});

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
  documents?: {
    type: string;
    base64: string;
  }[];
}

export function buildPGIPayload(app: BIApplication) {
  return {
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
    documents: (app.documents || []).map((d) => ({
      type: d.type,
      file: d.base64
    }))
  };
}

export async function submitToPGI(app: BIApplication, axiosClient: AxiosInstance = client) {
  const payload = buildPGIPayload(app);
  const response = await axiosClient.post("/applications", payload);

  return {
    externalId: response.data.id as string,
    status: response.data.status as string
  };
}

export async function getPGIStatus(externalId: string, axiosClient: AxiosInstance = client) {
  const res = await axiosClient.get(`/applications/${externalId}`);
  return res.data;
}
