// BI_SERVER_BF_DOC_FILE_v4
// Documents copied from Boreal Financial (bi_documents.bf_document_id) carry only BF's storage
// pointer, so neither staff View nor the carrier submission could read them ("File missing" 400,
// "blob not found"). BF-Server serves the file over its service bridge (BF-Server v701), for
// BI-linked applications only, behind the shared BACKEND_SERVICE_TOKEN.
import { backendTokenProblem } from "./backendToken";

const bfBase = () => (process.env.BF_SERVER_URL || "https://server.boreal.financial").replace(/\/+$/, "");

export async function fetchBfDocumentFile(
  bfDocumentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const token = String(process.env.BACKEND_SERVICE_TOKEN ?? "").trim();
  const problem = backendTokenProblem(token);
  if (problem) {
    console.warn("[bf-doc-file] " + problem);
    return null;
  }
  try {
    const r = await fetchImpl(`${bfBase()}/api/service/bi-documents/${encodeURIComponent(bfDocumentId)}/file`, {
      headers: { "x-backend-token": token },
    });
    if (!r.ok) {
      console.warn("[bf-doc-file] BF-Server did not return the file", { bfDocumentId, status: r.status });
      return null;
    }
    return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get("content-type") };
  } catch (err: any) {
    console.warn("[bf-doc-file] fetch failed", { bfDocumentId, message: err?.message });
    return null;
  }
}
