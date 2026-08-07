// BI_SERVER_PHONE_LEADING_ONE_v17
import { describe, it, expect } from "vitest";
import { normalizeE164, isPlausibleNanpNational } from "../util/phoneE164.js";

describe("normalizeE164 - valid input still works", () => {
  it("accepts 10 digits, 11 with country code, and the + form", () => {
    expect(normalizeE164("825 451 1768")).toBe("+18254511768");
    expect(normalizeE164("18254511768")).toBe("+18254511768");
    expect(normalizeE164("+1 825 451 1768")).toBe("+18254511768");
  });

  it("still collapses the autofill double-country-code case v406 fixed", () => {
    expect(normalizeE164("118254511768")).toBe("+18254511768");
    expect(normalizeE164("+118254511768")).toBe("+18254511768");
  });

  it("still passes through genuine international numbers", () => {
    expect(normalizeE164("+447700900000")).toBe("+447700900000");
  });
});

describe("normalizeE164 - the leading-1 short number", () => {
  it("rejects it without a plus instead of prepending a second +1", () => {
    expect(normalizeE164("1 423 205 619")).toBeNull();
    expect(normalizeE164("1 325 400 209")).toBeNull();
  });

  it("rejects it with a plus instead of passing through 10 digits", () => {
    expect(normalizeE164("+1 423-205-619")).toBeNull();
    expect(normalizeE164("+1 325-400-209")).toBeNull();
  });

  it("rejects an impossible NPA or NXX", () => {
    expect(normalizeE164("911 555 0123")).toBeNull();
    expect(normalizeE164("+1 403 911 0123")).toBeNull();
  });
});

describe("isPlausibleNanpNational", () => {
  it("rejects a leading 0 or 1 in either position", () => {
    expect(isPlausibleNanpNational("1423205619")).toBe(false);
    expect(isPlausibleNanpNational("4031555012")).toBe(false);
  });

  it("accepts a real number", () => {
    expect(isPlausibleNanpNational("8254511768")).toBe(true);
  });
});
