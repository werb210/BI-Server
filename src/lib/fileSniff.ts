// BI_SERVER_v789_FILE_SNIFF - upload allowlist by extension AND magic bytes.
//
// Used by the lender upload and the public applicant upload. The extension
// must be on the allowlist and the first bytes of the file must match what
// that extension promises:
//   pdf            %PDF-
//   jpg / jpeg     FF D8 FF
//   png            89 50 4E 47 0D 0A 1A 0A
//   heic           ISO BMFF "ftyp" box with brand heic/heix/mif1/msf1 (or
//                  hevc/hevx/heim/heis, which the same encoders emit)
//   doc / xls      OLE compound file D0 CF 11 E0 A1 B1 1A E1
//   docx / xlsx    zip PK 03 04
//   csv            no magic bytes: accepted when the sample holds no NUL byte
//                  and does not start with any of the binary signatures above.

export const ALLOWED_UPLOAD_EXTS = ["pdf", "jpg", "jpeg", "png", "heic", "doc", "docx", "xls", "xlsx", "csv"];

export type SniffResult =
  | { ok: true; ext: string }
  | { ok: false; reason: "extension_not_allowed" | "content_mismatch" };

const PDF = Buffer.from("%PDF-", "ascii");
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const HEIC_BRANDS = new Set(["heic", "heix", "mif1", "msf1", "hevc", "hevx", "heim", "heis"]);

function startsWith(buf: Buffer, sig: Buffer, offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return buf.subarray(offset, offset + sig.length).equals(sig);
}

function isPdf(buf: Buffer): boolean {
  // Some generators put a few bytes (BOM / whitespace) before %PDF-; the spec
  // allows the header anywhere in the first 1024 bytes.
  if (startsWith(buf, PDF)) return true;
  const idx = buf.subarray(0, 1024).indexOf(PDF);
  return idx >= 0;
}

function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const boxSize = buf.readUInt32BE(0);
  const major = buf.subarray(8, 12).toString("ascii");
  if (HEIC_BRANDS.has(major)) return true;
  // compatible brands follow the 4-byte minor version
  const end = Math.min(buf.length, boxSize >= 16 ? boxSize : buf.length, 64);
  for (let off = 16; off + 4 <= end; off += 4) {
    if (HEIC_BRANDS.has(buf.subarray(off, off + 4).toString("ascii"))) return true;
  }
  return false;
}

function looksBinary(buf: Buffer): boolean {
  return (
    isPdf(buf) ||
    startsWith(buf, JPEG) ||
    startsWith(buf, PNG) ||
    startsWith(buf, OLE) ||
    startsWith(buf, ZIP) ||
    isHeic(buf)
  );
}

function isCsvText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  return !looksBinary(sample);
}

/** Lower-case extension of a filename without the dot, or "" when there is none. */
export function fileExtension(filename: string): string {
  const base = String(filename || "").trim().split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function sniffFileType(buffer: Buffer, filename: string): SniffResult {
  const ext = fileExtension(filename);
  if (!ext || !ALLOWED_UPLOAD_EXTS.includes(ext)) return { ok: false, reason: "extension_not_allowed" };
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  let match = false;
  switch (ext) {
    case "pdf":
      match = isPdf(buf);
      break;
    case "jpg":
    case "jpeg":
      match = startsWith(buf, JPEG);
      break;
    case "png":
      match = startsWith(buf, PNG);
      break;
    case "heic":
      match = isHeic(buf);
      break;
    case "doc":
    case "xls":
      match = startsWith(buf, OLE);
      break;
    case "docx":
    case "xlsx":
      match = startsWith(buf, ZIP);
      break;
    case "csv":
      match = isCsvText(buf);
      break;
    default:
      match = false;
  }
  return match ? { ok: true, ext } : { ok: false, reason: "content_mismatch" };
}
