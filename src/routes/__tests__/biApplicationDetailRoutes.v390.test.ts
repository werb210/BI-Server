import fs from "fs";
import path from "path";

test("v390 marker exists", () => {
  const txt = fs.readFileSync(path.resolve(process.cwd(), "src/routes/biApplicationDetailRoutes.ts"), "utf8");
  expect(txt).toContain("BI_SERVER_BLOCK_v390_SEND_TO_CARRIER_DEPRECATED_v1");
  expect(txt).toContain("submit-to-pgi");
});
