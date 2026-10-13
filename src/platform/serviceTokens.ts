// BI_SERVER_v789_TOKENS - one place every BI-Server token is signed and verified.
//
// - Every token BI-Server signs carries iss "bi-server" and an aud: "bi-server"
//   for its own applicant / lender / referrer / staff tokens, "bf-server" for
//   service tokens it sends to BF-Server.
// - Every verify pins algorithms ["HS256"] and rejects a token whose aud is
//   present and is not "bi-server". Tokens with no aud (older BF-Server
//   tokens, tokens minted before this block) still pass.
// - Service tokens exchanged with BF-Server use BI_SERVICE_JWT_SECRET when it
//   is set; a JWT_SECRET-signed service token is then rejected. When it is
//   unset, JWT_SECRET (the previous behaviour).
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { getJwtSecret } from "./jwtSecret";

export const BI_ISSUER = "bi-server";
export const BI_AUDIENCE = "bi-server";
export const BF_AUDIENCE = "bf-server";
export const JWT_ALGORITHMS: jwt.Algorithm[] = ["HS256"];

export type TokenClaims = JwtPayload & Record<string, unknown>;

export function audienceAllowed(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const aud = (claims as { aud?: unknown }).aud;
  if (aud === undefined || aud === null) return true;
  const list = Array.isArray(aud) ? aud : [aud];
  // BI_SERVER_v792_STAFF_AUDIENCE - BF-Server staff access tokens carry aud
  // "boreal-staff-portal"; the portal sends them here for every BI screen.
  return list.includes(BI_AUDIENCE) || list.includes(STAFF_PORTAL_AUDIENCE);
}

/** Audience on BF-Server staff access tokens (BF-Server src/auth/jwt.ts JWT_AUDIENCE). */
export const STAFF_PORTAL_AUDIENCE = "boreal-staff-portal";

/** Verify with one or more accepted secrets. Returns the claims or null. */
export function verifyBiToken(token: string, secrets: string | string[]): TokenClaims | null {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  for (const secret of list) {
    try {
      const claims = jwt.verify(token, secret, { algorithms: JWT_ALGORITHMS });
      if (!claims || typeof claims !== "object") return null;
      if (!audienceAllowed(claims)) return null;
      return claims as TokenClaims;
    } catch {
      /* try the next accepted secret */
    }
  }
  return null;
}

/** Sign a token BI-Server issues for its own use (applicant, lender, referrer, staff). */
export function signBiToken(
  payload: Record<string, unknown>,
  expiresIn: SignOptions["expiresIn"],
  secret: string = getJwtSecret(),
): string {
  const { iss: _iss, aud: _aud, ...rest } = payload;
  return jwt.sign(rest, secret, {
    algorithm: "HS256",
    expiresIn,
    issuer: BI_ISSUER,
    audience: BI_AUDIENCE,
  });
}

export function bearerFrom(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.header("authorization") || "").trim());
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- service tokens

export function dedicatedServiceSecret(): string | null {
  return process.env.BI_SERVICE_JWT_SECRET || null;
}

/** Secret used for service tokens exchanged with BF-Server. */
export function serviceSecret(): string {
  return dedicatedServiceSecret() || getJwtSecret();
}

export function isServiceClaims(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const c = claims as Record<string, unknown>;
  if (c.kind === "service") return true;
  return c.sub === "bf-server" && c.scope === "bi:service";
}

/** True when the service claims say the caller is BF-Server. */
export function isFromBfServer(claims: unknown): boolean {
  if (!isServiceClaims(claims)) return false;
  const c = claims as Record<string, unknown>;
  return c.source === "bf-server" || c.sub === "bf-server";
}

/** Sign a service token BI-Server sends to BF-Server. */
export function signServiceTokenForBf(
  payload: Record<string, unknown> = {},
  expiresIn: SignOptions["expiresIn"] = "5m",
): string {
  return jwt.sign({ kind: "service", source: "bi-server", ...payload }, serviceSecret(), {
    algorithm: "HS256",
    expiresIn,
    issuer: BI_ISSUER,
    audience: BF_AUDIENCE,
  });
}

/**
 * Verify a service token sent by BF-Server. Uses only BI_SERVICE_JWT_SECRET
 * when it is set (so a JWT_SECRET-signed service token is rejected), else
 * JWT_SECRET. Returns null for anything that is not a service token.
 */
export function verifyServiceToken(token: string): TokenClaims | null {
  let secret: string;
  try {
    secret = serviceSecret();
  } catch {
    return null;
  }
  const claims = verifyBiToken(token, secret);
  if (!claims || !isServiceClaims(claims)) return null;
  return claims;
}

/** Express guard: only BF-Server service tokens. 401 without a valid token, 403 for any other principal. */
export function requireBfServiceToken(req: Request, res: Response, next: NextFunction) {
  const token = bearerFrom(req);
  if (!token) return res.status(401).json({ error: "missing_bearer" });
  const claims = verifyServiceToken(token);
  if (!claims) {
    // A valid non-service token (staff, applicant, lender) is a known principal
    // that is simply not allowed here.
    let known = false;
    try {
      known = verifyBiToken(token, [getJwtSecret(), process.env.BI_STAFF_JWT_SECRET || ""]) !== null;
    } catch { known = false; }
    return res.status(known ? 403 : 401).json({ error: known ? "service_only" : "invalid_token" });
  }
  if (!isFromBfServer(claims)) return res.status(403).json({ error: "service_only" });
  req.user = claims;
  return next();
}
