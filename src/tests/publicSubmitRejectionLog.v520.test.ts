// BI_SERVER_BLOCK_v520_PUBLIC_SUBMIT_REJECTION_LOG
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../routes/biPublicApplicationRoutes.ts"), "utf8");

describe("v520 applicant submit refusals are logged", () => {
  it("wraps the submit route and logs code + field names on any 4xx/5xx", () => {
    expect(src).toContain('router.use("/applications/:publicId/submit"');
    expect(src).toContain('"bi_public_submit_rejected"');
    expect(src).toContain("if (res.statusCode >= 400)");
  });
  it("is registered before the submit handler", () => {
    expect(src.indexOf('router.use("/applications/:publicId/submit"')).toBeLessThan(src.indexOf('router.post("/applications/:publicId/submit"'));
  });
});
