import { describe, it, expect } from "vitest";
import { normalizeE164 } from "../util/phoneE164";
describe("v406 phoneE164 collapses duplicate leading 1", () => {
  it("bare 10-digit", () => expect(normalizeE164("8254511768")).toBe("+18254511768"));
  it("11-digit 1+national", () => expect(normalizeE164("18254511768")).toBe("+18254511768"));
  it("THE BUG: no-plus 12-digit dup", () => expect(normalizeE164("118254511768")).toBe("+18254511768"));
  it("THE BUG: +-prefixed dup", () => expect(normalizeE164("+118254511768")).toBe("+18254511768"));
  it("formatted +1 with stray 1", () => expect(normalizeE164("+1 1 (825) 451-1768")).toBe("+18254511768"));
  it("triple leading 1", () => expect(normalizeE164("1118254511768")).toBe("+18254511768"));
  it("international passthrough preserved", () => expect(normalizeE164("+447911123456")).toBe("+447911123456"));
  it("garbage -> null", () => expect(normalizeE164("12345")).toBeNull());
});
