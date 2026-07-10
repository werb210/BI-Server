// BI_SERVER_REFERRAL_FROM_BF_v1
// Referrals are unified in BF. A referral pitched for PGI carries a BF-minted
// ref_code (no bi_referrals row). When the PGI policy binds, tell BF-Server so
// it credits the BF referrer 20% of premium. Auth is a service JWT
// ({ kind:"service", source:"bi-server" }) signed with the shared JWT_SECRET -
// the same pattern BF uses to call bi-server, reversed. Best-effort: never
// throws; the caller wraps it and swallows failures.
import jwt from "jsonwebtoken";
import { env } from "../platform/env";

const BF_SERVER_URL = (
  process.env.BF_SERVER_URL || "https://server.boreal.financial"
).replace(/\/+$/, "");

export async function notifyBfReferralConversion(input: {
  refCode: string;
  externalId: string;
  premium: number | null;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const secret = process.env.JWT_SECRET || env.JWT_SECRET || "";
  if (!secret) return { ok: false, error: "no_jwt_secret" };
  const refCode = String(input.refCode || "").trim();
  if (!refCode) return { ok: false, error: "no_ref_code" };
  try {
    const token = jwt.sign({ kind: "service", source: "bi-server" }, secret, {
      expiresIn: "5m",
    });
    const res = await fetch(`${BF_SERVER_URL}/api/referrals-ext/from-bi`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ref_code: refCode,
        external_id: String(input.externalId),
        premium: input.premium,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
