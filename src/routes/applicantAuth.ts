// BI_CLIENT_CONTRACT_ROUTES_v21 - shared applicant bearer guard.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../platform/jwtSecret"; // BI_SERVER_v784_JWT_SECRET

export interface ApplicantReq extends Request { applicantPhone?: string; }

export function authApplicant(req: ApplicantReq, res: Response, next: NextFunction) {
  const auth = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) return res.status(401).json({ error: "missing_bearer" });
  try {
    const payload = jwt.verify(match[1], getJwtSecret()) as any;
    if (payload?.kind !== "applicant" || !payload?.phone) {
      return res.status(401).json({ error: "wrong_kind" });
    }
    req.applicantPhone = String(payload.phone);
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
