// BI_SERVER_BLOCK_1_29_DOC_INTEL_SWAP
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
} from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { logger } from "../platform/logger";

let _diClient: ReturnType<typeof DocumentIntelligence> | null = null;

export function getAzureClient() {
  if (_diClient) return _diClient;
  const endpoint = process.env.AZURE_DOC_INTEL_ENDPOINT ?? process.env.AZURE_VISION_ENDPOINT;
  const key = process.env.AZURE_DOC_INTEL_KEY ?? process.env.AZURE_VISION_KEY;
  if (!endpoint || !key) {
    throw new Error(
      "Azure Document Intelligence not configured (AZURE_DOC_INTEL_ENDPOINT / AZURE_DOC_INTEL_KEY missing)",
    );
  }
  _diClient = DocumentIntelligence(endpoint, new AzureKeyCredential(key));
  return _diClient;
}

export interface OcrResult {
  status: "complete" | "failed" | "skipped";
  extractedText: string | null;
  error?: string;
}
export interface OcrInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const NATIVE_TEXT_MIMES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/rtf",
  "text/rtf",
]);
const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const DOC_MIMES = new Set(["application/msword"]);
const XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/tiff", "image/bmp"]);

export async function extractText(input: OcrInput): Promise<OcrResult> {
  const { buffer, mimeType, filename } = input;
  try {
    if (NATIVE_TEXT_MIMES.has(mimeType)) {
      return { status: "complete", extractedText: buffer.toString("utf-8") };
    }
    if (PDF_MIMES.has(mimeType)) return await extractPdf(buffer);
    if (DOCX_MIMES.has(mimeType)) {
      const result = await mammoth.extractRawText({ buffer });
      return { status: "complete", extractedText: result.value || "" };
    }
    if (XLSX_MIMES.has(mimeType)) return extractSpreadsheet(buffer);
    if (IMAGE_MIMES.has(mimeType)) return await extractWithDocIntel(buffer);
    if (DOC_MIMES.has(mimeType)) {
      logger.warn({ filename, mimeType }, "Legacy .doc — OCR not attempted, marking skipped");
      return { status: "skipped", extractedText: null };
    }
    logger.warn({ filename, mimeType }, "Unsupported MIME for OCR — marking skipped");
    return { status: "skipped", extractedText: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ filename, mimeType, error }, "OCR failed");
    return { status: "failed", extractedText: null, error };
  }
}

async function extractPdf(buffer: Buffer): Promise<OcrResult> {
  // Fast path: if the PDF has a real text layer, skip the API call.
  try {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").trim();
    if (text.length > 50) return { status: "complete", extractedText: parsed.text };
    logger.info("PDF has no/empty text layer — routing to Document Intelligence");
  } catch (err) {
    logger.warn({ err: String(err) }, "pdf-parse failed — routing to Document Intelligence");
  }
  return extractWithDocIntel(buffer);
}

async function extractWithDocIntel(buffer: Buffer): Promise<OcrResult> {
  const client = getAzureClient();
  // prebuilt-read: pure OCR, returns paragraphs/lines/words. For tables
  // and structure use prebuilt-layout — switching is a one-line change.
  const initial = await client
    .path("/documentModels/{modelId}:analyze", "prebuilt-read")
    .post({
      contentType: "application/octet-stream",
      body: buffer,
    });
  if (isUnexpected(initial)) {
    throw new Error(
      `Azure Doc Intel ${initial.status}: ${
        (initial.body as any)?.error?.message ?? "unknown error"
      }`,
    );
  }
  const poller = getLongRunningPoller(client, initial);
  const final = (await poller.pollUntilDone()).body as any;
  const result = final?.analyzeResult ?? {};

  // Prefer the document-level `content` string (whitespace-preserved
  // reading order). Fall back to joining paragraph or page lines.
  const content: string =
    typeof result.content === "string" && result.content.trim().length > 0
      ? result.content
      : Array.isArray(result.paragraphs)
        ? result.paragraphs.map((p: any) => p?.content ?? "").filter(Boolean).join("\n")
        : Array.isArray(result.pages)
          ? result.pages
              .flatMap((page: any) => page.lines ?? [])
              .map((l: any) => l?.content ?? "")
              .filter(Boolean)
              .join("\n")
          : "";

  return { status: "complete", extractedText: content };
}

function extractSpreadsheet(buffer: Buffer): OcrResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return { status: "complete", extractedText: parts.join("\n\n") };
}
