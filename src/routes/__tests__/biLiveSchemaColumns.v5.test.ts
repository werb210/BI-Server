// BI_SERVER_LIVE_SCHEMA_COLUMNS_v5
// Column sets read off bi-pg01 on 2026-08-03. These are source assertions
// rather than round-trips because the defect is the SQL text itself: each of
// these statements parsed fine and failed at the database.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const LIVE = {
  bi_contact_activity: ["id", "contact_id", "actor_id", "actor_name", "event_type", "outcome", "body", "meta", "created_at", "occurred_at"],
  bi_commissions: ["id", "application_id", "annual_premium_amount", "commission_rate", "commission_amount", "status", "premium_received_at", "paid_at", "created_at", "updated_at"],
  bi_referrers: ["id", "user_id", "company_name", "full_name", "email", "phone_e164", "agreement_status", "is_active", "created_at", "etransfer_email", "address_line1", "city", "province", "postal_code", "country", "profile_completed_at", "updated_at", "first_name", "last_name", "address_line2", "intake_complete"],
};

function insertColumns(sql: string, table: string): string[] {
  const m = new RegExp(`INSERT INTO ${table}\\s*\\(([^)]*)\\)`, "i").exec(sql);
  return m ? m[1].split(",").map((c) => c.trim()) : [];
}

describe("BI_SERVER_LIVE_SCHEMA_COLUMNS_v5", () => {
  it("the sequence-reply webhook writes columns bi_contact_activity has", () => {
    const src = read("src/integrations/microsoftGraphSubscriptions.ts");
    const cols = insertColumns(src, "bi_contact_activity");
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(LIVE.bi_contact_activity).toContain(c);
    expect(src).not.toMatch(/bi_contact_activity[^`]*\bkind\b/s);
    expect(src).not.toMatch(/bi_contact_activity[^`]*\bpayload\b/s);
  });
  it("a reply still marks the enrollment and records the event", () => {
    const src = read("src/integrations/microsoftGraphSubscriptions.ts");
    expect(src).toContain("SET status = 'replied'");
    expect(src).toContain("INSERT INTO bi_sequence_events");
    expect(src).toContain("outreach_stage = 'engaged'");
  });
  it("recurring commissions insert only real columns", () => {
    const cols = insertColumns(read("src/modules/commission.service.ts"), "bi_commissions");
    expect(cols).toContain("annual_premium_amount"); expect(cols).not.toContain("premium_amount"); expect(cols).not.toContain("commission_type");
    for (const c of cols) expect(LIVE.bi_commissions).toContain(c);
  });
  it("premium-received writes the fields the report actually reads", () => {
    const src = read("src/routes/biCommissionRoutes.ts");
    expect(src).not.toMatch(/SET\s+received\s*=/); expect(src).toContain("premium_received_at"); expect(src).toContain("status = 'received'");
  });
  it("neither referrer SMS lookup asks for display_name", () => {
    for (const rel of ["src/routes/biReferrerRoutes.ts", "src/services/pgiOnApprovedHook.ts"]) {
      const src = read(rel); const selects = src.match(/SELECT[^`]*FROM bi_referrers/gi) ?? []; expect(selects.length).toBeGreaterThan(0);
      for (const sql of selects) { expect(sql).not.toMatch(/\bdisplay_name\b/); for (const col of sql.replace(/SELECT/i, "").replace(/FROM bi_referrers/i, "").split(",")) { const name = col.trim().split(/\s+AS\s+/i)[0].trim(); if (name && /^[a-z_]+$/.test(name)) expect(LIVE.bi_referrers).toContain(name); } }
    }
  });
});
