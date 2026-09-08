// BI_SERVER_BLOCK_v262_SMS_DELIVERABILITY_v1
import { describe, expect, it } from "vitest";
import { isUndeliverableNumber, isPermanentSmsFailure, isSendableBody } from "../smsDeliverability";

describe("destination validation", () => {
  it("rejects the numbers that caused the August incident", () => {
    for (const n of ["+15555555555", "(555) 555-5555", "+11234567891", "5555555555"]) {
      expect(isUndeliverableNumber(n)).toBe(true);
    }
  });

  it("rejects structurally impossible NANP numbers", () => {
    expect(isUndeliverableNumber("1234")).toBe(true);          // too short
    expect(isUndeliverableNumber("+11111111111")).toBe(true);  // repeated digits
    expect(isUndeliverableNumber("+10234567890")).toBe(true);  // area code starts 0
    expect(isUndeliverableNumber("+14031234567")).toBe(true);  // exchange starts 1
  });

  it("accepts real numbers", () => {
    expect(isUndeliverableNumber("+14035551234")).toBe(true);  // 555 exchange still blocked
    expect(isUndeliverableNumber("+14032641234")).toBe(false);
    expect(isUndeliverableNumber("+12125550123")).toBe(true);
  });
});

describe("permanent failure classification", () => {
  it("treats an empty body as permanent", () => {
    expect(isPermanentSmsFailure({ code: 21602 })).toBe(true);
  });
  it("treats transient codes as retryable", () => {
    expect(isPermanentSmsFailure({ code: 30001 })).toBe(false);
    expect(isPermanentSmsFailure(new Error("network"))).toBe(false);
  });
});

describe("body validation", () => {
  it("blocks empty and whitespace-only bodies", () => {
    for (const b of ["", "   ", undefined, null]) expect(isSendableBody(b)).toBe(false);
    expect(isSendableBody("Your document was rejected")).toBe(true);
  });
});
