// BI_HARDENING_v44 — Azure Blob backend.
// BI_SERVER_BLOCK_v244_DEMO_REFERRER_STORAGE_v1 — lazy createIfNotExists
// before the first put(). The container was previously expected to be
// provisioned out of band (Azure Portal manual step). Deployments that
// missed that step 502'd every doc upload with "container does not
// exist". Self-healing makes the container a code-managed resource:
// if missing, we create it once per process and cache the flag so we
// don't waste an API call per upload.
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { StorageBackend, PutResult } from "./types";

export class AzureBlobBackend implements StorageBackend {
  private client: ContainerClient;
  private containerReady = false;
  constructor(private container: string, connectionString: string) {
    const svc = BlobServiceClient.fromConnectionString(connectionString);
    this.client = svc.getContainerClient(container);
  }

  private async ensureContainer(): Promise<void> {
    if (this.containerReady) return;
    // createIfNotExists is idempotent at the Azure API level; calling
    // it once at startup-of-first-write costs a single round-trip.
    // Private access (no anonymous read) — applies only on create.
    await this.client.createIfNotExists();
    this.containerReady = true;
  }

  async put(p: { buffer: Buffer; filename: string; contentType: string; pathPrefix?: string }): Promise<PutResult> {
    await this.ensureContainer();
    const ext = path.extname(p.filename) || "";
    const id = randomUUID();
    const blobName = `${p.pathPrefix ? p.pathPrefix.replace(/^\/+|\/+$/g, "") + "/" : ""}${id}${ext}`;
    const blob = this.client.getBlockBlobClient(blobName);
    await blob.uploadData(p.buffer, {
      blobHTTPHeaders: { blobContentType: p.contentType || "application/octet-stream" },
    });
    const hash = createHash("sha256").update(p.buffer).digest("hex");
    return { blobName, url: blob.url, hash, sizeBytes: p.buffer.length };
  }

  async get(blobName: string) {
    const blob = this.client.getBlockBlobClient(blobName);
    if (!(await blob.exists())) return null;
    const buf = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    return { buffer: buf, contentType: props.contentType ?? "application/octet-stream" };
  }

  async delete(blobName: string) {
    await this.client.getBlockBlobClient(blobName).deleteIfExists();
  }

  async ping() {
    try {
      await this.client.createIfNotExists();
      this.containerReady = true;
      return true;
    } catch {
      return false;
    }
  }

  describe() {
    return { kind: "azure" as const, container: this.container };
  }
}
