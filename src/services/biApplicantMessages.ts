// BI_SERVER_BLOCK_v607_APPLICANT_MESSAGES
// BI_SERVER_BLOCK_v611_MESSAGES_REPAIR - relay contract matches BF-Server v610's bridge:
//   GET  /api/service/applicant-messages          thread (+ unreadCount)
//   GET  /api/service/applicant-messages/unread   { unreadCount }
//   POST /api/service/applicant-messages/read     marks staff replies read
//   POST /api/service/applicant-messages          { body, attachments[] } -> the new message
// The applicant is identified by x-applicant-phone; the backend token authenticates BI-Server.
import { backendTokenProblem } from "./backendToken";

const bfBaseUrl = () => (process.env.BF_SERVER_URL || "[https://server.boreal.financial](https://server.boreal.financial)").replace(/\/+$/, "");
const backendToken = () => (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim();

export async function relayApplicantMessages(phone: string, method: "GET" | "POST", body?: unknown, fetchImpl: typeof fetch = fetch, subpath = "") {
  const token = backendToken();
  const problem = backendTokenProblem(token);
  if (problem) return { ok: false, status: 503, body: { error: "message_relay_not_configured", detail: problem } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const response = await fetchImpl(`${bfBaseUrl()}/api/service/applicant-messages${subpath}`, {
      method,
      headers: { "content-type": "application/json", "x-backend-token": token, "x-applicant-phone": phone, "x-silo": "BI" },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: ctrl.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: "invalid_upstream_response" }; }
    if (!response.ok) console.warn("[applicant-messages] BF-Server refused", { subpath, status: response.status });
    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

export function backendRequestIsAuthorized(value: string | undefined): boolean {
  const expected = backendToken();
  return !backendTokenProblem(expected) && typeof value === "string" && value === expected;
}

/** BF-Server v606/v610 sends its service token as a Bearer token and in x-service-token. */
export function serviceCallIsAuthorized(headers: { authorization?: string; xServiceToken?: string; xBackendToken?: string }): boolean {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? "")?.[1];
  return [bearer, headers.xServiceToken, headers.xBackendToken].some((v) => backendRequestIsAuthorized(v?.trim()));
}

export async function filesToAttachments(files: Array<{ originalname: string; mimetype: string; buffer: Buffer }>) {
  return files.slice(0, 3).map((f) => ({
    name: String(f.originalname || "file").slice(0, 200),
    contentType: f.mimetype || "application/octet-stream",
    dataUrl: `data:${f.mimetype || "application/octet-stream"};base64,${f.buffer.toString("base64")}`,
  }));
}
