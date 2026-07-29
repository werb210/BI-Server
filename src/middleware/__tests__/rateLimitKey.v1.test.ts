import { describe, expect, it } from "vitest";
import { ipv6Prefix64, rateLimitKeyFromRequest, stripPort } from "../rateLimitKey";

describe("rateLimitKey", () => {
  it("strips IPv4 and bracketed IPv6 ports without stripping IPv6 hextets", () => {
    expect(stripPort("77.246.52.163:62553")).toBe("77.246.52.163");
    expect(stripPort("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(stripPort("2001:db8::1")).toBe("2001:db8::1");
  });

  it("groups IPv6 addresses by /64 only", () => {
    expect(ipv6Prefix64("2001:db8::1")).toBe(ipv6Prefix64("2001:db8::2"));
    expect(ipv6Prefix64("2001:db8:0:1::1")).not.toBe(ipv6Prefix64("2001:db8:0:2::1"));
  });

  it("uses the first forwarded hop and always returns a key", () => {
    expect(rateLimitKeyFromRequest({ headers: { "x-forwarded-for": "77.246.52.163:62553, 10.0.0.4" } } as any)).toBe("77.246.52.163");
    expect(rateLimitKeyFromRequest({ headers: {} } as any)).toBe("unknown");
  });
});
