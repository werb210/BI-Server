import net from "node:net";
import type { Request } from "express";

/** Remove a transport port without mistaking an IPv6 hextet for one. */
export function stripPort(value: string): string {
  const raw = value.trim();
  const bracketed = raw.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed && net.isIP(bracketed[1])) return bracketed[1];
  if (net.isIP(raw)) return raw;
  const ipv4WithPort = raw.match(/^(.+):(\d+)$/);
  if (ipv4WithPort && net.isIP(ipv4WithPort[1]) === 4) return ipv4WithPort[1];
  return raw;
}

function expandedIpv6(ip: string): string[] | null {
  let value = ip.toLowerCase().split("%")[0];
  if (net.isIP(value) !== 6) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  return parts.length === 8 ? parts.map((part) => part.padStart(4, "0")) : null;
}

/** Use a stable /64 key so IPv6 privacy addresses cannot evade throttling. */
export function ipv6Prefix64(ip: string): string {
  const parts = expandedIpv6(ip);
  return parts ? `${parts.slice(0, 4).join(":")}::/64` : ip;
}

// BI_SERVER_OTP_ABUSE_GUARD_v716
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, "");
  if (net.isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  if (net.isIP(v) === 6) {
    const lower = v.toLowerCase();
    return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

export function rateLimitKeyFromRequest(req: Pick<Request, "headers"> & Partial<Pick<Request, "ip">>): string {
  // BI_SERVER_OTP_ABUSE_GUARD_v716 - Azure APPENDS the real caller to X-Forwarded-For; entries to
  // its left were written by the caller and can be forged (a bot could send a new fake address on
  // every request and never be limited). Walk from the right and take the first public address,
  // skipping private/internal hops in case a proxy sits behind the front end.
  const forwarded = req.headers["x-forwarded-for"];
  const hops = (Array.isArray(forwarded) ? forwarded.join(",") : String(forwarded ?? ""))
    .split(",").map((h) => stripPort(h.trim())).filter(Boolean);
  let picked = "";
  for (let i = hops.length - 1; i >= 0; i--) {
    if (net.isIP(hops[i]) && !isPrivateIp(hops[i])) { picked = hops[i]; break; }
  }
  const ip = stripPort(picked || hops[hops.length - 1] || req.ip || "");
  if (net.isIP(ip) === 6) return ipv6Prefix64(ip);
  if (net.isIP(ip) === 4) return ip;
  // Never pass an invalid IP to express-rate-limit's default generator; doing
  // so raises ERR_ERL_INVALID_IP_ADDRESS on Azure's IP:port forwarding format.
  return ip || "unknown";
}
