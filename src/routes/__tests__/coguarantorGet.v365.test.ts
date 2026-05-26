// BI_SERVER_BLOCK_v365_COGUARANTOR_GET_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../biApplicationDetailRoutes.ts"), "utf8");

describe("v365 — GET /:id/co-guarantors endpoint", () => {
  it("route registered with requireStaffOrAdmin guard", () => {
    expect(src).toMatch(/router\.get\("\/:id\/co-guarantors", requireStaffOrAdmin/);
  });
  it("queries bi_co_guarantors with application_id filter", () => {
    expect(src).toMatch(/FROM bi_co_guarantors[\s\S]*WHERE application_id = \$1/);
  });
  it("response includes the fields BF-portal expects", () => {
    for (const field of ["first_name", "last_name", "full_name", "email", "date_of_birth", "phone", "address", "city", "province", "postal_code", "relationship"]) {
      expect(src).toMatch(new RegExp(`${field}[:\\s]`));
    }
  });
  it("returns 500 on DB error", () => {
    expect(src).toMatch(/co_guarantor_list_failed/);
  });
});
