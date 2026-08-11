import { describe, expect, it } from "vitest";
import {
  audienceParams, buildAudienceBreakdownSql, buildAudienceCountSql,
  buildAudienceSelectSql, contactMergeVars,
} from "../biEmailAudience";
import { mergeFields, sendgridConfigured } from "../biSendgridService";

describe("BI bulk marketing audience", () => {
  for (const [name, sql] of [["count", buildAudienceCountSql()], ["select", buildAudienceSelectSql()]]) {
    it(`${name} fails closed on consent`, () => expect(sql).toContain("marketing_consent_basis IS NOT NULL"));
    it(`${name} honors expiry`, () => expect(sql).toContain("marketing_consent_expires_at > NOW()"));
    it(`${name} excludes suppressions`, () => expect(sql).toContain("s.channel IN ('email', 'all')"));
    it(`${name} matches suppression email case-insensitively`, () => expect(sql).toContain("lower(s.email) = lower(c.email)"));
    it(`${name} requires a plausible email`, () => expect(sql).toContain("position('@' in c.email) > 1"));
    it(`${name} applies include tags without regard to case`, () => expect(sql).toContain("lower(trim(t)) = ANY($1)"));
    it(`${name} applies exclude tags without regard to case`, () => {
      expect(sql).toContain("NOT EXISTS (");
      expect(sql).toContain("lower(trim(t)) = ANY($2)");
    });
  }
  it("selects BI contact names", () => expect(buildAudienceSelectSql()).toContain("c.full_name"));
  it("does not invent a silo field", () => expect(buildAudienceSelectSql()).not.toContain("silo"));
  for (const column of ["with_email", "suppressed", "no_consent_recorded", "consent_expired"]) {
    it(`reports ${column}`, () => expect(buildAudienceBreakdownSql()).toContain(column));
  }
  it("normalizes include tags", () => expect(audienceParams({ includeTags: ["Lender", "ACTIVE"] })[0]).toEqual(["lender", "active"]));
  it("uses null for empty exclude tags", () => expect(audienceParams({ excludeTags: [] })[1]).toBeNull());
  it("uses null when tags are omitted", () => expect(audienceParams({})[0]).toBeNull());
  it("derives first name", () => expect(contactMergeVars({ full_name: "Ada Lovelace" }).first_name).toBe("Ada"));
  it("substitutes merge values", () => expect(mergeFields("Hi {{first_name}} at {{company}}", { first_name: "Ada", company: "Analytical" })).toBe("Hi Ada at Analytical"));
  it("does not leak unknown tokens", () => expect(mergeFields("{{unknown}}", {})).not.toContain("{{"));
  it("tolerates token case and spacing", () => expect(mergeFields("{{ FIRST_NAME }}", { first_name: "Ada" })).toBe("Ada"));
  it("is unconfigured without environment values", () => expect(sendgridConfigured()).toBe(false));
});
