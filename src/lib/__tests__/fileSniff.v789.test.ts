// BI_SERVER_v789 [63] upload allowlist by extension AND magic bytes.
import { describe, it, expect } from "vitest";
import { sniffFileType, ALLOWED_UPLOAD_EXTS, fileExtension } from "../fileSniff";

const PDF = Buffer.from("%PDF-1.7\n...");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0]);
function ftyp(major: string, compat: string[] = []): Buffer {
  const size = 16 + compat.length * 4;
  const b = Buffer.alloc(size + 8);
  b.writeUInt32BE(size, 0);
  b.write("ftyp", 4, "ascii");
  b.write(major, 8, "ascii");
  compat.forEach((c, i) => b.write(c, 16 + i * 4, "ascii"));
  return b;
}
const CSV = Buffer.from("name,amount\nAcme,100\n");

describe("sniffFileType", () => {
  it("exports the agreed allowlist", () => {
    expect(ALLOWED_UPLOAD_EXTS).toEqual(["pdf", "jpg", "jpeg", "png", "heic", "doc", "docx", "xls", "xlsx", "csv"]);
  });

  it.each([
    ["a.pdf", PDF], ["a.PDF", PDF], ["a.jpg", JPG], ["a.jpeg", JPG], ["a.png", PNG],
    ["a.heic", ftyp("heic")], ["a.heic", ftyp("heix")], ["a.heic", ftyp("mif1", ["heic"])], ["a.heic", ftyp("msf1")],
    ["a.doc", OLE], ["a.xls", OLE], ["a.docx", ZIP], ["a.xlsx", ZIP], ["a.csv", CSV],
  ])("accepts %s with matching bytes", (name, buf) => {
    const r = sniffFileType(buf, name);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ext).toBe(fileExtension(name));
  });

  it.each([["a.exe"], ["a.html"], ["a.svg"], ["noext"], ["a."], ["a.pdf.js"]])("rejects extension %s", (name) => {
    expect(sniffFileType(PDF, name)).toEqual({ ok: false, reason: "extension_not_allowed" });
  });

  it.each([
    ["a.pdf", PNG], ["a.png", JPG], ["a.jpg", PDF], ["a.docx", OLE], ["a.doc", ZIP],
    ["a.heic", ftyp("isom", ["mp41"])], ["a.xlsx", PDF], ["a.pdf", Buffer.alloc(0)],
  ])("rejects %s whose bytes do not match", (name, buf) => {
    expect(sniffFileType(buf, name)).toEqual({ ok: false, reason: "content_mismatch" });
  });

  it("csv: rejects NUL bytes, binary signatures and empty files", () => {
    expect(sniffFileType(Buffer.from("a,b\n\u0000c"), "a.csv")).toEqual({ ok: false, reason: "content_mismatch" });
    expect(sniffFileType(ZIP, "a.csv")).toEqual({ ok: false, reason: "content_mismatch" });
    expect(sniffFileType(PDF, "a.csv")).toEqual({ ok: false, reason: "content_mismatch" });
    expect(sniffFileType(Buffer.alloc(0), "a.csv")).toEqual({ ok: false, reason: "content_mismatch" });
  });
});
