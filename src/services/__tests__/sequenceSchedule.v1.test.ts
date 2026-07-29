import { describe, expect, it } from "vitest";
import { isSendableAt, nextSendableAt, scheduleFromNow } from "../sequenceSchedule";

const window = { startHour: 9, endHour: 21, weekdaysOnly: true };

describe("sequence schedule", () => {
  it("evaluates business hours in Edmonton", () => {
    expect(isSendableAt(new Date("2026-07-29T16:00:00Z"), window)).toBe(true);
    expect(isSendableAt(new Date("2026-07-29T09:00:00Z"), window)).toBe(false);
  });

  it("skips weekends when configured", () => {
    const saturday = new Date("2026-08-01T18:00:00Z");
    expect(isSendableAt(saturday, window)).toBe(false);
    expect(isSendableAt(saturday, { ...window, weekdaysOnly: false })).toBe(true);
    expect(nextSendableAt(saturday, window).toISOString()).toBe("2026-08-03T15:00:00.000Z");
  });

  it("never shortens the requested delay", () => {
    const now = new Date("2026-07-29T16:00:00Z");
    const result = scheduleFromNow(3 * 86_400, window, now);
    expect(result.getTime()).toBeGreaterThanOrEqual(now.getTime() + 3 * 86_400_000);
    expect(isSendableAt(result, window)).toBe(true);
  });
});
