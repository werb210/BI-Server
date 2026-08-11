// BI_AUDIENCE_TAG_CASE_v33
import { describe, expect, it } from "vitest";
import {
  audienceParams,
  buildAudienceCountSql,
  buildAudienceSelectSql,
} from "../biEmailAudience";

const count = buildAudienceCountSql();
const select = buildAudienceSelectSql();

describe("tags are matched without regard to case", () => {
  it("no longer uses the case-sensitive overlap operator", () => {
    expect(count).not.toContain("&& $1");
    expect(count).not.toContain("&& $2");
  });

  it("compares lower(trim(tag)) on the stored side as well as the sent side", () => {
    expect(count).toContain("lower(trim(t)) = ANY($1)");
    expect(count).toContain("lower(trim(t)) = ANY($2)");
  });

  it("keeps exclusion as a negation of that same test", () => {
    expect(count).toContain("NOT EXISTS (");
  });
});

describe("the approved count and the actual send cannot disagree", () => {
  it("both are built from one predicate", () => {
    // select appends ORDER BY, so compare the WHERE clause itself.
    const predicate = (sql: string) => {
      const from = sql.indexOf("WHERE");
      const to = sql.indexOf("ORDER BY");
      return (to > from ? sql.slice(from, to) : sql.slice(from)).trim();
    };
    expect(predicate(select)).toBe(predicate(count));
  });
});

describe("the filter parameters are normalised, not trusted", () => {
  it("lowercases and trims what the composer sends", () => {
    expect(audienceParams({ includeTags: ["  Lender ", "SLF"] })[0]).toEqual(["lender", "slf"]);
  });

  it("treats an empty or blank list as no filter at all", () => {
    expect(audienceParams({})[0]).toBeNull();
    expect(audienceParams({ includeTags: [] })[0]).toBeNull();
    expect(audienceParams({ includeTags: ["  ", ""] })[0]).toBeNull();
  });

  it("de-duplicates tags that differ only by case", () => {
    expect(audienceParams({ excludeTags: ["Lender", "lender", "LENDER"] })[1]).toEqual(["lender"]);
  });

  it("carries include and exclude independently", () => {
    const [include, exclude] = audienceParams({ includeTags: ["A"], excludeTags: ["B"] });
    expect(include).toEqual(["a"]);
    expect(exclude).toEqual(["b"]);
  });
});
