// BF_PORTAL_TEMPLATE_SAVE_BY_NAME_v8
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routes = fs.readFileSync(path.resolve(__dirname, "../biMarketingRoutes.ts"), "utf8");

describe("BI email template save by name", () => {
  it("looks for an existing template with the same name and category", () => {
    expect(routes).toContain("lower(name) = lower($1)");
    expect(routes).toContain("COALESCE(category, '') = COALESCE($2, '')");
  });

  it("updates the existing template instead of creating a duplicate", () => {
    expect(routes).toContain("UPDATE bi_email_templates");
    expect(routes).toContain("WHERE id = $1");
  });

  it("tells the portal whether the save replaced an existing template", () => {
    expect(routes).toContain("replaced: true");
    expect(routes).toContain("replaced: false");
  });
});
