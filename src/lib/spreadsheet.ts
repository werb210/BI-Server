// BI_SERVER_SPREADSHEET_EXCELJS_v376
// SheetJS "xlsx" 0.18.5 has unpatched high-severity advisories (prototype
// pollution, ReDoS) and no fixed release on npm. Uploaded spreadsheets are
// untrusted, so parsing moves to exceljs. .xlsx is read as a workbook; any
// other buffer is read as CSV text. Legacy binary .xls is refused with a
// plain message instead of being parsed.
import ExcelJS from "exceljs";

export type Sheet = { name: string; rows: string[][] };

const isZip = (b: Buffer) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isLegacyXls = (b: Buffer) => b.length > 7 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1;

export class UnsupportedSpreadsheetError extends Error {
  constructor() {
    super("Old .xls files are not supported - save it as .xlsx or .csv and upload again");
  }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export async function readSheets(buffer: Buffer): Promise<Sheet[]> {
  if (isLegacyXls(buffer)) throw new UnsupportedSpreadsheetError();
  if (!isZip(buffer)) return [{ name: "Sheet1", rows: parseCsv(buffer.toString("utf-8")) }];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c += 1) cells.push(row.getCell(c).text ?? "");
      rows.push(cells);
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

/** First sheet as objects keyed by the header row; blank cells are null (was sheet_to_json defval:null). */
export async function readFirstSheetObjects(buffer: Buffer): Promise<Array<Record<string, unknown>> | null> {
  const [first] = await readSheets(buffer);
  if (!first) return null;
  const [header, ...body] = first.rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => {
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const v = (r[i] ?? "").trim();
      obj[k] = v === "" ? null : v;
    });
    return obj;
  });
}

/** Test/fixture helper: build an .xlsx buffer from rows. */
export async function buildXlsx(rows: unknown[][], sheetName = "Sheet1"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
