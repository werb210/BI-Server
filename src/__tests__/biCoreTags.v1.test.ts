// BI_SERVER_BI_CORE_TAGS_v1
import { describe, expect, it } from "vitest";
import { BI_CORE_TAGS } from "../services/crmUnify/tags";

describe("BI core tags", () => {
  it("leave out Active, Insurance and A/R Credit Insurance", () => {
    expect(BI_CORE_TAGS.map((t) => t.slug)).toEqual(["lender", "broker", "lawyer", "accountant", "referrer"]);
  });
});
