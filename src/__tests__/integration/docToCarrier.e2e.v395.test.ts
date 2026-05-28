// BI_SERVER_BLOCK_v395_DOC_TO_CARRIER_E2E_v2
// v2 fix: make the test self-contained so it passes under ANY ambient env
// (in particular a default CI run, where USE_PGI_STUB defaults to true and
// pgiUploadDocument would short-circuit to a stub, failing this test). The
// STUB / PGI_BASE flags are frozen at module load, so we set the env and
// re-import the adapter (vi.resetModules + dynamic import) inside beforeEach
// rather than relying on the run command to export USE_PGI_STUB=false.
//
// Proves a real document survives the path to the PGI CARRIER byte-for-byte:
//   stored bytes (real LocalBackend storage)
//     -> store.get(storage_key)   (real storage read-back)
//       -> pgiUploadDocument(...)  (real multipart wire format)
//         -> carrier HTTP          (global fetch stubbed)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

const REAL_DOC = Buffer.from(
  "%PDF-1.4\n% BI-V395-UNIQUE-MARKER-9c1e\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  "latin1",
);

let pgiUploadDocument: typeof import("../../services/pgiAdapter")["pgiUploadDocument"];
let getStorage: typeof import("../../lib/storage")["getStorage"];
let __resetStorageForTests: typeof import("../../lib/storage")["__resetStorageForTests"];

describe("v395 - document survives the path to the PGI carrier byte-for-byte", () => {
  const realFetch = global.fetch;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    process.env.USE_PGI_STUB = "false";
    process.env.PGI_BASE_URL = "https://carrier.test";
    process.env.PGI_API_KEY = "pk_test_v395";
    process.env.JWT_SECRET ||= "test_jwt_secret_32_chars_minimum_xx";
    process.env.JWT_REFRESH_SECRET ||= "test_refresh_secret_32_chars_min_xx";
    process.env.BI_STAFF_JWT_SECRET ||= "test_staff_jwt_secret_32_chars_min_x";
    process.env.PGI_WEBHOOK_SECRET ||= "test_webhook_secret_32_chars_min_xx";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    vi.resetModules();
    ({ pgiUploadDocument } = await import("../../services/pgiAdapter"));
    ({ getStorage, __resetStorageForTests } = await import("../../lib/storage"));
    __resetStorageForTests();
  });
  afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); __resetStorageForTests?.(); });

  it("stores a document, reads it back, and uploads the EXACT bytes to the carrier", async () => {
    const put = await getStorage().put({
      buffer: REAL_DOC, filename: "loan-agreement.pdf",
      contentType: "application/pdf", pathPrefix: "applications/app-123",
    });
    expect(put.blobName).toBeTruthy();

    const got = await getStorage().get(put.blobName);
    expect(got?.buffer).toBeTruthy();
    expect(got!.buffer.equals(REAL_DOC)).toBe(true);

    let captured: { url: string; auth: string | undefined; fd: FormData } | null = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      captured = {
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization,
        fd: init?.body as FormData,
      };
      return { ok: true, status: 200, json: async () => ({ document_id: "PGI_DOC_REAL_1", doc_type: "loan_agreement", received_at: new Date().toISOString() }) } as any;
    }) as any;

    const res = await pgiUploadDocument({
      pgiApplicationId: "PGI-APP-XYZ",
      docType: "loan_agreement",
      filename: "loan-agreement.pdf",
      buffer: got!.buffer,
      mimeType: "application/pdf",
    });
    expect(res.document_id).toBe("PGI_DOC_REAL_1");

    expect(captured).not.toBeNull();
    const cap = captured!;
    expect(cap.url).toContain("/api/v2/applications/PGI-APP-XYZ/documents/");
    expect(cap.auth).toMatch(/^Bearer /);
    expect(cap.fd.get("doc_type")).toBe("loan_agreement");

    const filePart = cap.fd.get("file");
    expect(filePart).toBeTruthy();
    const sentBytes = Buffer.from(await (filePart as Blob).arrayBuffer());
    expect(sentBytes.equals(REAL_DOC)).toBe(true);
    expect((filePart as File).name).toBe("loan-agreement.pdf");
    expect((filePart as Blob).type).toBe("application/pdf");
  });

  it("propagates a carrier rejection instead of silently succeeding", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 422, json: async () => ({ error: "bad doc" }),
    })) as any;
    await expect(
      pgiUploadDocument({
        pgiApplicationId: "PGI-APP-XYZ", docType: "balance_sheet",
        filename: "bs.pdf", buffer: REAL_DOC, mimeType: "application/pdf",
      }),
    ).rejects.toThrow(/PGI doc upload failed/);
  });
});
