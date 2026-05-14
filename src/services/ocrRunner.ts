// BI_SERVER_BLOCK_v273_PUBLIC_UPLOAD_OCR_v1
// Shared OCR runner. Originally lived inside biDocumentRoutes as a
// local function; promoted so the public-flow upload handler can
// call it too. Fire-and-forget pattern: caller wraps in
// `void runOcrForDocument(...).catch(() => {})` to avoid unhandled
// rejections, errors are persisted onto the row's ocr_error column.
import { pool } from "../db";
import { extractText } from "./ocrService";

export async function runOcrForDocument(
  docId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
): Promise<void> {
  try {
    await pool.query(`UPDATE bi_documents SET ocr_status='processing' WHERE id=$1`, [docId]);
    const result = await extractText({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });
    await pool.query(
      `UPDATE bi_documents
       SET ocr_status=$2,
           extracted_text=$3,
           ocr_error=$4,
           ocr_completed_at=NOW()
       WHERE id=$1`,
      [docId, result.status, result.extractedText, result.error ?? null]
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE bi_documents
       SET ocr_status='failed',
           ocr_error=$2,
           ocr_completed_at=NOW()
       WHERE id=$1`,
      [docId, error]
    ).catch(() => { /* swallow nested DB error */ });
  }
}
