// BI_SERVER_BLOCK_v395_DOC_TO_CARRIER_E2E_v1
// The BI analog of BF v394. Proves a real document survives the path to the
// PGI CARRIER byte-for-byte. On the BI side documents don't go to a lender
// by email — they're POSTed to the carrier as multipart by pgiUploadDocument
// (the forwarding the v391 fix wired up on the lender path, and the staff-
// accept backfill on the public path). The chain exercised here mirrors the
// real staff-accept forwarding in biApplicationDetailRoutes:
//
//   stored bytes (real LocalBackend storage)
//     → store.get(storage_key)          (real storage read-back)
//       → pgiUploadDocument(...)         (real multipart wire format)
//         → carrier HTTP                 (global fetch stubbed)
//
// We pull the `file` part back out of the multipart FormData the carrier
// request carried and assert it equals the original stored bytes. Run with
// USE_PGI_STUB=false so the REAL upload path executes (the block's gate sets
// this); a stubbed run would skip the network entirely and prove nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { pgiUploadDocument } from "../../services/pgiAdapter";
import { getStorage, __resetStorageForTests } from "../../lib/storage";

// A recognizable "real document" with a unique marker so byte-identity is
// unambiguous.
const REAL_DOC = Buffer.from(
  "%PDF-1.4\n% BI-V395-UNIQUE-MARKER-9c1e\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  "latin1",
);

describe("v395 — document survives the path to the PGI carrier byte-for-byte", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    __resetStorageForTests();
    delete process.env.AZURE_STORAGE_CONNECTION_STRING; // force LocalBackend
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    __resetStorageForTests();
  });

  it("stores a document, reads it back, and uploads the EXACT bytes to the carrier", async () => {
    // 1) Put a real document into the REAL storage layer.
    const put = await getStorage().put({
      buffer: REAL_DOC,
      filename: "loan-agreement.pdf",
      contentType: "application/pdf",
      pathPrefix: "applications/app-123",
    });
    expect(put.blobName).toBeTruthy();

    // 2) Read it back exactly as the staff-accept forwarding does.
    const got = await getStorage().get(put.blobName);
    expect(got?.buffer).toBeTruthy();
    expect(got!.buffer.equals(REAL_DOC)).toBe(true); // storage round-trip is exact

    // 3) Capture the multipart request the carrier upload makes.
    let captured: { url: string; auth: string | undefined; fd: FormData } | null = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      captured = {
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization,
        fd: init?.body as FormData,
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          document_id: "PGI_DOC_REAL_1",
          doc_type: "loan_agreement",
          received_at: new Date().toISOString(),
        }),
      } as any;
    }) as any;

    // 4) Forward the stored bytes to the carrier (real wire format).
    const res = await pgiUploadDocument({
      pgiApplicationId: "PGI-APP-XYZ",
      docType: "loan_agreement",
      filename: "loan-agreement.pdf",
      buffer: got!.buffer,
      mimeType: "application/pdf",
    });
    expect(res.document_id).toBe("PGI_DOC_REAL_1");

    // 5) Assert what actually hit the carrier.
    expect(captured).not.toBeNull();
    const cap = captured!;
    expect(cap.url).toContain("/api/v2/applications/PGI-APP-XYZ/documents/");
    expect(cap.auth).toMatch(/^Bearer /); // authenticated
    expect(cap.fd.get("doc_type")).toBe("loan_agreement");

    // BYTE-IDENTITY: the file part the carrier received equals the original.
    const filePart = cap.fd.get("file");
    expect(filePart).toBeTruthy();
    const sentBytes = Buffer.from(await (filePart as Blob).arrayBuffer());
    expect(sentBytes.equals(REAL_DOC)).toBe(true);

    // Mutation check: a one-byte change would make the assertion fail.
    const mutated = Buffer.from(REAL_DOC);
    mutated[mutated.length - 1] ^= 0xff;
    expect(sentBytes.equals(mutated)).toBe(false);

    // Filename + content type carried through.
    expect((filePart as File).name).toBe("loan-agreement.pdf");
    expect((filePart as Blob).type).toBe("application/pdf");
  });

  it("propagates a carrier rejection instead of silently succeeding", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "bad doc" }),
    })) as any;

    await expect(
      pgiUploadDocument({
        pgiApplicationId: "PGI-APP-XYZ",
        docType: "balance_sheet",
        filename: "bs.pdf",
        buffer: REAL_DOC,
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow(/PGI doc upload failed/);
  });
});
