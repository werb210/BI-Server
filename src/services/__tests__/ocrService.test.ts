import { describe, expect, it } from "vitest";
import { extractText, getAzureClient } from "../ocrService";

describe("ocrService", () => {
  it("returns utf-8 text for native text MIME", async () => {
    const result = await extractText({
      buffer: Buffer.from("hello world", "utf-8"),
      mimeType: "text/plain",
      filename: "note.txt",
    });
    expect(result.status).toBe("complete");
    expect(result.extractedText).toBe("hello world");
  });

  it("returns skipped for unsupported MIME", async () => {
    const result = await extractText({
      buffer: Buffer.from("x"),
      mimeType: "application/octet-stream",
      filename: "blob.bin",
    });
    expect(result.status).toBe("skipped");
    expect(result.extractedText).toBeNull();
  });

  it("throws when Azure Vision env vars are missing", () => {
    delete process.env.AZURE_VISION_ENDPOINT;
    delete process.env.AZURE_VISION_KEY;
    expect(() => getAzureClient()).toThrow(/Azure Vision is not configured/i);
  });
});
