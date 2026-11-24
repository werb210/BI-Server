// BI_SERVER_LONG_ROUTES_v1
import { describe, expect, it } from "vitest";
import { timeoutFor } from "../apiTimeoutGuard";

describe("api timeout guard", () => {
  it("gives bulk list import and export more time", () => {
    expect(timeoutFor("/api/v1/bi/crm/list-import")).toBe(180000);
    expect(timeoutFor("/api/v1/bi/crm/directory-export")).toBe(60000);
    expect(timeoutFor("/api/v1/bi/crm/contacts")).toBe(10000);
  });
});
