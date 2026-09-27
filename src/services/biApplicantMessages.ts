// BI_SERVER_BLOCK_v607_APPLICANT_MESSAGES
import { backendTokenProblem } from "./backendToken";

const bfBaseUrl = () => (process.env.BF_SERVER_URL || "https://server.boreal.financial").replace(/\/+$/, "");
const backendToken = () => (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim();

export async function relayApplicantMessages(phone: string, method: "GET" | "POST", body?: unknown, fetchImpl: typeof fetch = fetch) {
  const token = backendToken();
  const problem = backendTokenProblem(token);
  if (problem) return { ok: false, status: 503, body: { error: "message_relay_not_configured", detail: problem } };
  const response = await fetchImpl(`${bfBaseUrl()}/api/service/applicant-messages`, {
    method,
    headers: { "content-type": "application/json", "x-backend-token": token, "x-applicant-phone": phone },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: "invalid_upstream_response" }; }
  return { ok: response.ok, status: response.status, body: parsed };
}

export function backendRequestIsAuthorized(value: string | undefined): boolean {
  const expected = backendToken();
  return !backendTokenProblem(expected) && typeof value === "string" && value === expected;
}
