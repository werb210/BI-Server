import ImageAnalysisClient, { isUnexpected } from "@azure-rest/ai-vision-image-analysis";
import { AzureKeyCredential } from "@azure/core-auth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { logger } from "../platform/logger";

let _azureClient: ReturnType<typeof ImageAnalysisClient> | null = null;
export function getAzureClient() {
  if (_azureClient) return _azureClient;
  const endpoint = process.env.AZURE_VISION_ENDPOINT;
  const key = process.env.AZURE_VISION_KEY;
  if (!endpoint || !key) {
    throw new Error("Azure Vision is not configured (AZURE_VISION_ENDPOINT / AZURE_VISION_KEY missing)");
  }
  _azureClient = ImageAnalysisClient(endpoint, new AzureKeyCredential(key));
  return _azureClient;
}

export interface OcrResult { status: "complete" | "failed" | "skipped"; extractedText: string | null; error?: string; }
export interface OcrInput { buffer: Buffer; mimeType: string; filename: string; }

const NATIVE_TEXT_MIMES = new Set(["text/plain", "text/csv", "text/markdown", "application/rtf", "text/rtf"]);
const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const DOC_MIMES = new Set(["application/msword"]);
const XLSX_MIMES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export async function extractText(input: OcrInput): Promise<OcrResult> {
  const { buffer, mimeType, filename } = input;
  try {
    if (NATIVE_TEXT_MIMES.has(mimeType)) return { status: "complete", extractedText: buffer.toString("utf-8") };
    if (PDF_MIMES.has(mimeType)) return await extractPdf(buffer);
    if (DOCX_MIMES.has(mimeType)) {
      const result = await mammoth.extractRawText({ buffer });
      return { status: "complete", extractedText: result.value || "" };
    }
    if (XLSX_MIMES.has(mimeType)) return extractSpreadsheet(buffer);
    if (IMAGE_MIMES.has(mimeType)) return await extractImageOcr(buffer);
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
  try {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").trim();
    if (text.length > 50) return { status: "complete", extractedText: parsed.text };
    logger.info("PDF has no/empty text layer — routing to Azure OCR");
  } catch (err) {
    logger.warn({ err: String(err) }, "pdf-parse failed — routing to Azure OCR");
  }
  return extractImageOcr(buffer);
}

async function extractImageOcr(buffer: Buffer): Promise<OcrResult> {
  const client = getAzureClient();
  const resp = await client.path("/imageanalysis:analyze").post({
    body: buffer,
    queryParameters: { features: ["Read"] },
    contentType: "application/octet-stream",
  });
  if (isUnexpected(resp)) throw new Error(`Azure CV ${resp.status}: ${resp.body?.error?.message ?? "unknown error"}`);

  const blocks = (resp.body as any).readResult?.blocks ?? [];
  const text = blocks.flatMap((b: any) => b.lines ?? []).map((l: any) => l.text).filter(Boolean).join("\n");
  return { status: "complete", extractedText: text };
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
