import { NextFunction, Request, Response } from "express";
import { getStaffJwtSecret, getStaffVerifySecrets } from "./jwtSecret";
import { dedicatedServiceSecret, isServiceClaims, signBiToken, verifyBiToken } from "./serviceTokens";

export function signStaffToken(payload: { staffUserId: string; role: string; phone?: string; userType?: string; capabilities?: string[] }) {
  return signBiToken(payload, "8h", getStaffJwtSecret());
}

// BI_SERVER_v784_STAFF_ONLY_AUTH
// requireAuth used to accept ANY token signed with the shared secret, so BI
// applicant OTP tokens, BF client tokens, lender/referrer tokens and tracked
// link tokens all passed staff routes. Only these callers are staff:
//   - BF staff roles Admin, Staff, Ops, Marketing (and BI "owner")
//   - any service token (kind "service")
//   - BF-Server's carrier-submit token { sub: "bf-server", scope: "bi:service" }
const STAFF_ROLES = new Set(["admin", "staff", "ops", "marketing", "owner"]);
const NON_STAFF_KINDS = new Set(["applicant", "client", "lender", "referrer"]);

export function isStaffOrServiceClaims(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const c = claims as Record<string, unknown>;
  if (c.kind === "service") return true;
  if (c.sub === "bf-server" && c.scope === "bi:service") return true;
  if (typeof c.kind === "string" && NON_STAFF_KINDS.has(c.kind.toLowerCase())) return false;
  if (c.sid !== undefined && c.u !== undefined) return false; // tracked-link token
  const role = typeof c.role === "string" ? c.role.toLowerCase() : "";
  return STAFF_ROLES.has(role);
}

function verifyBearer(req: Request, res: Response): Record<string, unknown> | string | null {
  const auth = req.headers.authorization;

  if (!auth) {
    res.status(401).json({ status: "error", error: "Unauthorized" });
    return null;
  }

  const token = auth.replace(/^Bearer\s+/i, "").trim();

  let secrets: string[];
  try {
    secrets = getStaffVerifySecrets();
  } catch {
    res.status(500).json({ status: "error", error: "jwt_secret_missing" });
    return null;
  }

  // BI_SERVER_v789_TOKENS - when BI_SERVICE_JWT_SECRET is set, service tokens
  // are verified with it alone; a service token signed with JWT_SECRET (or the
  // staff secret) is rejected.
  const serviceOnly = dedicatedServiceSecret();
  if (serviceOnly) {
    const svc = verifyBiToken(token, serviceOnly);
    if (svc && isServiceClaims(svc)) return svc;
  }

  const claims = verifyBiToken(token, secrets);
  if (!claims || (serviceOnly && isServiceClaims(claims))) {
    res.status(401).json({ status: "error", error: "Invalid token" });
    return null;
  }
  return claims;
}

// Verifies the token signature only, with no role check. Used by the legacy
// applicant draft/submit routes, whose tokens come from /api/v1/otp/verify.
export function requireAnyAuth(req: Request, res: Response, next: NextFunction) {
  const decoded = verifyBearer(req, res);
  if (decoded === null) return;
  req.user = decoded;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const decoded = verifyBearer(req, res);
  if (decoded === null) return;
  if (!isStaffOrServiceClaims(decoded)) {
    return res.status(403).json({ status: "error", error: "staff_only" });
  }

  {
    // BI_SERVER_BLOCK_v176_AUTH_SUB_NORMALIZER_v1
    // BF-Server JWTs sign 'sub' (standard JWT). BI code reads
    // req.user.staffUserId. Without normalization, every BF-portal
    // action against BI loses user attribution. Mirror sub -> staffUserId
    // when only the standard claim is present.
    if (decoded && typeof decoded === "object") {
      const obj = decoded as Record<string, unknown>;
      if (typeof obj.sub === "string" && !obj.staffUserId) {
        obj.staffUserId = obj.sub;
      }
      // Also normalize role to lowercase so cross-silo role checks
      // (e.g. v160 admin gate) don't break on 'Admin' vs 'admin'.
      if (typeof obj.role === "string") {
        obj.role = obj.role.toLowerCase();
      }
    }
    req.user = decoded;
    // BI_SERVER_BLOCK_v411_STAFF_CAPS_FROM_ROLE_v1 — BF-Server staff JWTs carry
    // BF capability strings, not BI's marketing:* set, so capability-gated BI
    // CRM writes (bulk-tag / bulk-delete) returned 403 for valid staff. Grant
    // the BI capability set to any authenticated staff/admin based on role.
    try {
      const u = req.user as Record<string, unknown> | undefined;
      const role = typeof u?.role === "string" ? u.role : "";
      if (u && (role === "admin" || role === "owner" || role === "staff" || role === "marketing")) {
        const existing = Array.isArray(u.capabilities) ? (u.capabilities as string[]) : [];
        const biCaps = role === "admin" || role === "owner"
          ? ["crm:read", "marketing:lists", "marketing:outreach", "marketing:admin"]
          : ["crm:read", "marketing:lists", "marketing:outreach"];
        u.capabilities = Array.from(new Set([...existing, ...biCaps]));
      }
    } catch { /* non-fatal: leave capabilities unchanged */ }
    next();
  }
}
