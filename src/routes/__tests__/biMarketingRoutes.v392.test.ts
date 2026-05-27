import fs from "fs";
import path from "path";

test("v392 marker and count logs exist", () => {
  const txt = fs.readFileSync(path.resolve(process.cwd(), "src/routes/biAdminLenderRoutes.ts"), "utf8");
  expect(txt).toContain("BI_SERVER_BLOCK_v392_MARKETING_IMPORT_FIX_v1");
  expect(txt).toContain("apollo_total_entries");
});
