// BI_SERVER_TEMPLATE_SAVE_BY_NAME_v10
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routes = fs.readFileSync(path.resolve(__dirname, "../biMarketingRoutes.ts"), "utf8");

describe("BI template save by name", () => {
  it("looks up a prior template with the same name", () => {
    expect(routes).toContain("SELECT id FROM bi_email_templates WHERE name = $1");
  });
  it("updates it rather than inserting a duplicate", () => {
    expect(routes).toContain("UPDATE bi_email_templates");
    expect(routes).toContain("replaced: true");
  });
});
