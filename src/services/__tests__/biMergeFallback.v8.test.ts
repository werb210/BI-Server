// BI_SERVER_MERGE_FALLBACK_v8
import { describe, it, expect } from "vitest";
import { contactMergeVars } from "../biEmailAudience";

describe("BI merge field fallback", () => {
  it("never renders an empty greeting", () => {
    const v = contactMergeVars({ email: "a@b.ca" });
    expect(v.first_name).toBe("there");
    expect(v.full_name).toBe("there");
  });

  it("uses the real name when there is one", () => {
    const v = contactMergeVars({ full_name: "Priya Raman", email: "p@r.ca" });
    expect(v.first_name).toBe("Priya");
    expect(v.full_name).toBe("Priya Raman");
  });

  it("handles a single-word name", () => {
    expect(contactMergeVars({ full_name: "Cher" }).first_name).toBe("Cher");
  });

  it("treats whitespace as absent", () => {
    expect(contactMergeVars({ full_name: "   " }).first_name).toBe("there");
  });

  it("leaves company empty rather than saying 'at there'", () => {
    expect(contactMergeVars({ email: "a@b.ca" }).company).toBe("");
  });
});
