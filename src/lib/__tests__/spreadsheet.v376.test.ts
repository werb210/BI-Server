// BI_SERVER_SPREADSHEET_EXCELJS_v376
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildXlsx, parseCsv, readFirstSheetObjects, readSheets, toCsv, UnsupportedSpreadsheetError } from "../spreadsheet";

describe("spreadsheet parsing without SheetJS", () => {
  it("reads an xlsx into rows and header-keyed objects", async () => {
    const buf = await buildXlsx([["Email", "First Name"], ["a@x.com", "Ann"], ["b@x.com", null]]);
    const sheets = await readSheets(buf);
    expect(sheets[0].name).toBe("Sheet1");
    expect(sheets[0].rows[1]).toEqual(["a@x.com", "Ann"]);
    expect(await readFirstSheetObjects(buf)).toEqual([
      { Email: "a@x.com", "First Name": "Ann" },
      { Email: "b@x.com", "First Name": null },
    ]);
  });
  it("reads CSV with quotes, commas and a BOM", async () => {
    const csv = Buffer.from('\uFEFFname,note\n"Smith, J","said ""hi"""\r\nLee,ok\n');
    expect(await readFirstSheetObjects(csv)).toEqual([
      { name: "Smith, J", note: 'said "hi"' },
      { name: "Lee", note: "ok" },
    ]);
  });
  it("refuses legacy binary .xls plainly", async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(readSheets(xls)).rejects.toBeInstanceOf(UnsupportedSpreadsheetError);
  });
  it("round-trips CSV quoting", () => {
    const rows = [["a,b", 'c"d'], ["e", "f"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("the vulnerable packages are gone", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.xlsx).toBeUndefined();
    expect(deps.nodemailer).toBeUndefined();
    expect(deps.exceljs).toBeDefined();
  });
});
