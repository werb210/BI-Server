// BI_SERVER_BI_CORE_TAGS_v1
import { describe, expect, it } from "vitest";
import { BI_CORE_TAGS } from "../services/crmUnify/tags";

describe("BI core tags", () => {
  it("leave out Active, Insurance, A/R Credit Insurance, Lawyer and Accountant", () => {
    expect(BI_CORE_TAGS.map((t) => t.slug)).toEqual(["lender", "broker", "referrer"]);
  });
});
