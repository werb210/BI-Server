// BI_SERVER_ALBERTA_TIME_v711
import { describe, expect, it } from "vitest";
import { SEQUENCE_TIME_ZONE, isSendableAt } from "../sequenceSchedule";

describe("BI send windows use Alberta time, UTC-6 all year", () => {
  it("9 a.m. Alberta in December is 15:00 UTC", () => {
    expect(SEQUENCE_TIME_ZONE).toBe("America/Regina");
    const w = { startHour: 9, endHour: 21, weekdaysOnly: true };
    expect(isSendableAt(new Date("2026-12-07T15:00:00Z"), w)).toBe(true);
    expect(isSendableAt(new Date("2026-12-07T14:59:00Z"), w)).toBe(false);
  });
});
