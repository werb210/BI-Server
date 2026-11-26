// BI_SERVER_REFERRAL_PHONES_v1 - the phone number an out-of-office reply gives for a colleague is saved on the contact.
import { describe, expect, it } from "vitest";
import { referralPhone } from "../workers/flowWorker.js";

describe("referralPhone", () => {
  it("reads North American numbers however they are written", () => {
    expect(referralPhone("(985) 249-7258")).toBe("+19852497258");
    expect(referralPhone("504-565-3654")).toBe("+15045653654");
    expect(referralPhone("1 (647) 402-4023")).toBe("+16474024023");
  });
  it("leaves anything else to the note", () => {
    expect(referralPhone("12345")).toBeNull();
    expect(referralPhone("+44 20 7946 0958")).toBeNull();
    expect(referralPhone(undefined)).toBeNull();
  });
});
