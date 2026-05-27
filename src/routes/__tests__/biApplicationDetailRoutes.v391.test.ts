import fs from "fs";
import path from "path";

test("v391 marker exists", () => {
  const txt = fs.readFileSync(path.resolve(process.cwd(), "src/routes/biApplicationDetailRoutes.ts"), "utf8");
  expect(txt).toContain("BI_SERVER_BLOCK_v391_AUTO_SUBMIT_ON_LAST_DOC_ACCEPT_v1");
  expect(txt).toContain("submitLenderApplicationToCarrier");
});
