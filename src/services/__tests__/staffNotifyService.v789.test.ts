// BI_SERVER_v789_LOG_MASKING + BI_SERVER_v789_STAFF_ALERT_THROTTLE
import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const warn = vi.fn();
const error = vi.fn();
vi.mock("../../platform/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: (...a: unknown[]) => error(...a), info: vi.fn() } }));
const create = vi.fn();
vi.mock("twilio", () => ({ default: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }) }));

import { notifyStaff, staffAlertAllowed, resetStaffAlertThrottle, STAFF_ALERT_WINDOW_MS } from "../staffNotifyService";

const UNDELIVERABLE = "+14165550123"; // 555 exchange
const GOOD = "+14167771234";

describe("staff SMS log lines mask the phone number", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM = "+15873330000";
    warn.mockReset();
    error.mockReset();
    create.mockReset();
    queryMock.mockReset().mockImplementation(answerBySql([
      ["FROM bi_staff_notify_recipients", { rows: [{ phone_e164: UNDELIVERABLE }, { phone_e164: GOOD }] }],
    ]));
  });

  it("skipped and failed sends log only the last 4 digits", async () => {
    create.mockRejectedValue(Object.assign(new Error("twilio says no"), { code: 21610 }));
    const out = await notifyStaff("contact_form", "hello");
    expect(out).toEqual({ sent: 0, skipped: 2 });
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls].map((c) => c[0]));
    expect(logged).not.toContain("4165550123");
    expect(logged).not.toContain("4167771234");
    expect(logged).toContain("***0123");
    expect(logged).toContain("***1234");
    // The SMS itself still goes to the full number.
    expect(create.mock.calls[0][0].to).toBe(GOOD);
  });
});

describe("staffAlertAllowed", () => {
  beforeEach(() => resetStaffAlertThrottle());

  it("allows one alert per key per 10 minutes; any matching key suppresses", () => {
    const t0 = 1_000_000;
    expect(staffAlertAllowed(["phone:+1416", "ip:1.2.3.4"], t0)).toBe(true);
    expect(staffAlertAllowed(["phone:+1416", "ip:9.9.9.9"], t0 + 1000)).toBe(false);
    expect(staffAlertAllowed(["phone:+1999", "ip:1.2.3.4"], t0 + 1000)).toBe(false);
    expect(staffAlertAllowed(["phone:+1999", "ip:9.9.9.9"], t0 + 1000)).toBe(true);
    expect(staffAlertAllowed(["phone:+1416"], t0 + STAFF_ALERT_WINDOW_MS - 1)).toBe(false);
    expect(staffAlertAllowed(["phone:+1416"], t0 + STAFF_ALERT_WINDOW_MS)).toBe(true);
  });
});
