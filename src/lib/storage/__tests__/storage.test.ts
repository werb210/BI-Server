// BI_HARDENING_v44 — storage interface test
import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { LocalBackend } from "../local";

describe("BI_HARDENING_v44 storage", () => {
  let backend: LocalBackend;
  beforeEach(() => {
    backend = new LocalBackend(path.join(os.tmpdir(), `bi-storage-${Date.now()}-${Math.random()}`));
  });

  it("put + get roundtrip preserves bytes and computes sha256", async () => {
    const buf = Buffer.from("hello-bi");
    const r = await backend.put({ buffer: buf, filename: "x.txt", contentType: "text/plain", pathPrefix: "applications/abc" });
    expect(r.blobName).toMatch(/^applications\/abc\//);
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.sizeBytes).toBe(buf.length);
    const got = await backend.get(r.blobName);
    expect(got?.buffer.toString("utf8")).toBe("hello-bi");
  });

  it("describe reports kind=local", () => {
    expect(backend.describe().kind).toBe("local");
  });
});
