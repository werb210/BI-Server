import { describe, it, expect } from "vitest";
import { extractMentionTokens } from "../biMentions";

describe("BI_V1_FINAL_v47 extractMentionTokens", () => {
  it("finds simple mentions", () => {
    expect(extractMentionTokens("@alice please review")).toEqual(["alice"]);
  });
  it("dedupes lowercase", () => {
    expect(extractMentionTokens("@Bob @bob @CAROL").sort()).toEqual(["bob", "carol"]);
  });
  it("ignores email addresses", () => {
    expect(extractMentionTokens("ping me at me@x.com")).toEqual([]);
  });
});
