// BI_HARDENING_v44 — Storage abstraction: same shape across BF/BI so V2 chunked uploads
// and a base64 endpoint slot in behind one interface.
export interface PutResult {
  blobName: string;
  url: string;
  hash: string;
  sizeBytes: number;
}

export interface StorageBackend {
  put(params: {
    buffer: Buffer;
    filename: string;
    contentType: string;
    pathPrefix?: string;
  }): Promise<PutResult>;
  get(blobName: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  delete(blobName: string): Promise<void>;
  ping(): Promise<boolean>;
  describe(): { kind: "azure" | "local"; container?: string };
}
