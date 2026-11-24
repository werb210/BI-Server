// BI_SERVER_FLOW_ATTACHMENTS_v1 - a flow email can carry collateral PDFs (BF portal: Settings > Content > Collateral).
// The files live on BF-Server; BI-Server reads them over the service bridge (BF-Server BF_SERVER_SERVICE_COLLATERAL_v1)
// and keeps each one for ten minutes, so a batch of sends reads a file once.
import { backendTokenProblem } from "../backendToken";

export const MAX_FLOW_ATTACHMENTS = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 10 * 60_000;

export type FlowAttachment = { content: string; filename: string; type: string; disposition: "attachment" };
type Cached = { at: number; file: FlowAttachment };
const cache = new Map<string, Cached>();

const bfBase = () => (process.env.BF_SERVER_URL || "https://server.boreal.financial").replace(/\/+$/, "");
const token = () => String(process.env.BACKEND_SERVICE_TOKEN ?? process.env.BI_BACKEND_TOKEN ?? "").trim();

/** Cleans what an editor sent: collateral ids only, no repeats, at most three. */
export function cleanAttachmentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v ?? "").trim()).filter((v) => UUID.test(v)))].slice(0, MAX_FLOW_ATTACHMENTS);
}

function pdfName(raw: string | null): string {
  const m = /filename="([^"]+)"/i.exec(raw ?? "");
  const base = (m?.[1] ?? "Boreal Risk Management").replace(/[^ -~]/g, "").trim() || "Boreal Risk Management";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** One collateral file ready for SendGrid, or throws (the send is then retried like any other failure). */
export async function loadAttachment(id: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<FlowAttachment> {
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.file;
  const problem = backendTokenProblem(token());
  if (problem) throw new Error(problem);
  const r = await fetchImpl(`${bfBase()}/api/service/collateral/${encodeURIComponent(id)}/file`, {
    headers: { "x-backend-token": token() },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`collateral ${id} could not be read from BF-Server (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const file: FlowAttachment = {
    content: buf.toString("base64"),
    filename: pdfName(r.headers.get("content-disposition")),
    type: r.headers.get("content-type") || "application/pdf",
    disposition: "attachment",
  };
  cache.set(id, { at: now, file });
  return file;
}

export async function loadAttachments(ids: unknown, fetchImpl: typeof fetch = fetch): Promise<FlowAttachment[]> {
  const out: FlowAttachment[] = [];
  for (const id of cleanAttachmentIds(ids)) out.push(await loadAttachment(id, fetchImpl));
  return out;
}

/** The collateral list from BF-Server, for the flow editor. */
export async function listCollateral(fetchImpl: typeof fetch = fetch): Promise<Array<{ id: string; name: string; size_bytes: number | null }>> {
  const problem = backendTokenProblem(token());
  if (problem) throw new Error(problem);
  const r = await fetchImpl(`${bfBase()}/api/service/collateral`, { headers: { "x-backend-token": token() }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`BF-Server collateral list failed (${r.status})`);
  const j = (await r.json()) as { items?: Array<{ id: string; name: string; size_bytes: number | null }> };
  return (j.items ?? []).map((x) => ({ id: String(x.id), name: String(x.name), size_bytes: x.size_bytes ?? null }));
}

export function clearAttachmentCache(): void { cache.clear(); }
