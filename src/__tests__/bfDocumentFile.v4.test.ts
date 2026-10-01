// BI_SERVER_BF_DOC_FILE_v4
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBfDocumentFile } from "../services/bfDocumentFile";

afterEach(() => { delete process.env.BACKEND_SERVICE_TOKEN; delete process.env.BF_SERVER_URL; });

describe("v4 files copied from Boreal Financial are fetched from BF-Server", () => {
  it("asks BF-Server's service bridge with the backend token and returns the bytes", async () => {
    process.env.BACKEND_SERVICE_TOKEN = "tok-v4";
    process.env.BF_SERVER_URL = "https://bf.example/";
    const fetchImpl = vi.fn(async () => new Response("%PDF-x", { status: 200, headers: { "content-type": "application/pdf" } }));
    const got = await fetchBfDocumentFile("11111111-1111-4111-8111-111111111111", fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://bf.example/api/service/bi-documents/11111111-1111-4111-8111-111111111111/file",
      { headers: { "x-backend-token": "tok-v4" } },
    );
    expect(got?.buffer.toString()).toBe("%PDF-x");
    expect(got?.contentType).toBe("application/pdf");
  });
  it("returns null (never throws) when BF refuses or the token is missing", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 404 }));
    expect(await fetchBfDocumentFile("x", fetchImpl as any)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    process.env.BACKEND_SERVICE_TOKEN = "tok-v4";
    expect(await fetchBfDocumentFile("x", fetchImpl as any)).toBeNull();
  });
  it("staff view, download and the carrier submission all use it", () => {
    const routes = readFileSync("src/routes/biDocumentRoutes.ts", "utf8");
    expect(routes.split("await fetchBfDocumentFile(row.bf_document_id)").length - 1).toBe(2);
    expect(routes.split("mime_type, bf_document_id FROM bi_documents").length - 1).toBe(2);
    const carrier = readFileSync("src/services/biPgiSubmissionService.ts", "utf8");
    expect(carrier).toContain(": d.bf_document_id ? await fetchBfDocumentFile(d.bf_document_id)");
    expect(carrier).toContain("storage_key, blob_name, bf_document_id");
  });
});
