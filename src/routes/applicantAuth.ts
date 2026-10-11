// BI_CLIENT_CONTRACT_ROUTES_v21 - shared applicant bearer guard.
import type { Request, Response, NextFunction } from "express";
import { verifyBiToken } from "../platform/serviceTokens";
import { getJwtSecret } from "../platform/jwtSecret"; // BI_SERVER_v784_JWT_SECRET
import { pool } from "../db";

export interface ApplicantReq extends Request { applicantPhone?: string; }

export function authApplicant(req: ApplicantReq, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) return res.status(401).json({ error: "missing_bearer" });
  try {
    const payload = verifyBiToken(match[1], getJwtSecret()) as any;
    if (!payload) return res.status(401).json({ error: "invalid_token" });
    if (payload?.kind !== "applicant" || !payload?.phone) {
      return res.status(401).json({ error: "wrong_kind" });
    }
    req.applicantPhone = String(payload.phone);
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// BI_SERVER_v789_APPLICANT_OWNERSHIP - the one ownership check for applicant
// routes: the application (by public id or id, or "me" for the applicant's
// latest open one) must carry the applicant's phone as applicant_phone_e164 or
// guarantor_phone. Used by biApplicantSubmitRoutes and the legacy
// /bi/application/submit in biAuthRoutes.
export async function ownedApplication(publicIdOrId: string, phone: string) {
  if (publicIdOrId === "me") {
    const mine = await pool.query(
      `SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone
         FROM bi_applications
        WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
          AND status IN ('created','in_progress','ready_for_submission')
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!mine.rows[0]) return { app: null as any, error: "not_found" as const };
    return { app: mine.rows[0], error: null };
  }
  const r = await pool.query(
    `SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone
       FROM bi_applications WHERE public_id = $1 OR id::text = $1 LIMIT 1`,
    [publicIdOrId],
  );
  const app = r.rows[0];
  if (!app) return { app: null as any, error: "not_found" as const };
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!phone || !owners.includes(phone)) return { app: null as any, error: "not_owner" as const };
  return { app, error: null };
}

/**
 * The applicant phone carried by a token, or null when the token is not an
 * applicant's. Accepts both applicant token shapes: { kind: "applicant", phone }
 * (biApplicantOtpRoutes) and the legacy /api/v1/otp/verify token
 * { staffUserId, role: "applicant", userType: "applicant", phone }.
 */
export function applicantPhoneFromClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const c = claims as Record<string, unknown>;
  const phone = typeof c.phone === "string" ? c.phone.trim() : "";
  if (!phone) return null;
  if (c.kind === "applicant") return phone;
  if (c.kind === undefined && c.role === "applicant" && (c.userType === undefined || c.userType === "applicant")) return phone;
  return null;
}
