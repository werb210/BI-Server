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

export function rateLimitKeyFromRequest(req: Pick<Request, "headers"> & Partial<Pick<Request, "ip">>): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const ip = stripPort(first || req.ip || "");
  if (net.isIP(ip) === 6) return ipv6Prefix64(ip);
  if (net.isIP(ip) === 4) return ip;
  // Never pass an invalid IP to express-rate-limit's default generator; doing
  // so raises ERR_ERL_INVALID_IP_ADDRESS on Azure's IP:port forwarding format.
  return ip || "unknown";
}
