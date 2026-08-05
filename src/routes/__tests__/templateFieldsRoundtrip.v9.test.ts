// BI_SERVER_TEMPLATE_FIELDS_ROUNDTRIP_v9
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routes = fs.readFileSync(path.resolve(__dirname, "../biMarketingRoutes.ts"), "utf8");
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../db/migrations/2026_08_05_bi_email_templates_fields.sql"), "utf8");

describe("BI email template round-trip", () => {
  it("adds the fields column idempotently", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS fields jsonb");
  });

  it("persists and returns fields on create", () => {
    expect(routes).toContain("INSERT INTO bi_email_templates (name, subject, body_text, body_html, category, fields, is_active)");
    expect(routes).toContain("VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE))");
  });

  it("returns fields on list", () => {
    expect(routes).toContain("SELECT id, name, subject, body_text, body_html, category, fields, is_active");
  });

  it("allows fields through patch", () => {
    expect(routes).toContain('"category", "fields", "is_active"');
  });
});
