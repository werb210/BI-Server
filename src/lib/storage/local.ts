// BI_HARDENING_v44 — Local filesystem backend. Used in tests + dev fallback when
// AZURE_STORAGE_CONNECTION_STRING is absent in NODE_ENV=test.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StorageBackend, PutResult } from "./types";

export class LocalBackend implements StorageBackend {
  constructor(private root: string) {}

  private async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async put(p: { buffer: Buffer; filename: string; contentType: string; pathPrefix?: string }): Promise<PutResult> {
    await this.ensureRoot();
    const ext = path.extname(p.filename) || "";
    const id = randomUUID();
    const blobName = `${p.pathPrefix ? p.pathPrefix.replace(/^\/+|\/+$/g, "") + "/" : ""}${id}${ext}`;
    const full = path.join(this.root, blobName);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, p.buffer);
    const hash = createHash("sha256").update(p.buffer).digest("hex");
    return { blobName, url: `local://${blobName}`, hash, sizeBytes: p.buffer.length };
  }

  async get(blobName: string) {
    try {
      const buf = await fs.readFile(path.join(this.root, blobName));
      return { buffer: buf, contentType: "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async delete(blobName: string) {
    await fs.unlink(path.join(this.root, blobName)).catch(() => {});
  }

  async ping() {
    await this.ensureRoot();
    return true;
  }

  describe() {
    return { kind: "local" as const };
  }
}
