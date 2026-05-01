// BI_SERVER_BLOCK_1_29_DOC_INTEL_SWAP
import { describe, it, expect, beforeEach, vi } from "vitest";
import { extractText } from "../ocrService";

beforeEach(() => {
  vi.resetModules();
  delete process.env.AZURE_DOC_INTEL_ENDPOINT;
  delete process.env.AZURE_DOC_INTEL_KEY;
  delete process.env.AZURE_VISION_ENDPOINT;
  delete process.env.AZURE_VISION_KEY;
});

describe("BI_SERVER_BLOCK_1_29_DOC_INTEL_SWAP — extractText", () => {
  it("returns native text for text/plain without calling Azure", async () => {
    const r = await extractText({
      buffer: Buffer.from("hello world", "utf8"),
      mimeType: "text/plain",
      filename: "x.txt",
    });
    expect(r.status).toBe("complete");
    expect(r.extractedText).toBe("hello world");
  });

  it("returns CSV-shaped text for xlsx without calling Azure", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["a", "b"],
      ["1", "2"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await extractText({
      buffer: buf,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "x.xlsx",
    });
    expect(r.status).toBe("complete");
    expect(r.extractedText).toContain("Sheet: Sheet1");
    expect(r.extractedText).toContain("a,b");
  });

  it("returns skipped for unsupported MIME and never throws", async () => {
    const r = await extractText({
      buffer: Buffer.alloc(4),
      mimeType: "application/x-weird",
      filename: "x.bin",
    });
    expect(r.status).toBe("skipped");
    expect(r.extractedText).toBeNull();
  });
});
