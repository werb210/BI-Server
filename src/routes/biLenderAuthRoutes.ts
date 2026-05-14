// BI_SERVER_BLOCK_v221_LENDER_OTP_AND_ME_v1
// Lender OTP-SMS auth + identity + own-applications list for BI-Website /lender flow.
// Pattern mirrors referrer OTP routes; phone matched against bi_lenders.contact_phone_e164.
// Lender must be pre-provisioned (no auto-create — provisioning console is priority #4).
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { sendOtpSafe, verifyOtpSafe } from "../services/otpService";

const router = express.Router();

function normalizeE164(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return null;
}

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}

function verifyLenderJwt(req: Request): { id: string } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; id?: string };
    if (p?.kind !== "lender" || !p?.id) return null;
    return { id: String(p.id) };
  } catch {
    return null;
  }
}
router.post("/api/v1/lender/otp/start", async (req: Request, res: Response) => {
  const phone = normalizeE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM bi_lenders
      WHERE contact_phone_e164 = $1 AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [phone],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_provisioned" });
  const sr = await sendOtpSafe(phone);
  if (!sr.ok) return res.status(502).json({ error: "otp_send_failed", detail: sr.error });
  return res.json({ ok: true });
});
router.post("/api/v1/lender/otp/verify", async (req: Request, res: Response) => {
  const phone = normalizeE164(req.body?.phone);
  const code = String(req.body?.code ?? "").trim();
  if (!phone) return res.status(400).json({ error: "invalid_phone" });
  if (!code) return res.status(400).json({ error: "missing_code" });
  const vr = await verifyOtpSafe(phone, code);
  if (!vr.ok) return res.status(502).json({ error: "otp_verify_failed", detail: vr.error });
  if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });

  const r = await pool.query<{
    id: string; company_name: string | null;
    contact_full_name: string | null; contact_email: string | null;
  }>(
    `SELECT id, company_name, contact_full_name, contact_email
       FROM bi_lenders
      WHERE contact_phone_e164 = $1 AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [phone],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_provisioned" });

  const ld = r.rows[0];
  const secret = getSecret();
  if (!secret) return res.status(500).json({ error: "server_secret_missing" });
  const token = jwt.sign({ kind: "lender", id: ld.id }, secret, { expiresIn: "7d" });
  return res.json({
    token,
    lender: {
      id: ld.id,
      company_name: ld.company_name,
      name: ld.contact_full_name,
      email: ld.contact_email,
    },
  });
});
router.get("/api/v1/lender/me", async (req: Request, res: Response) => {
  const v = verifyLenderJwt(req);
  if (!v) return res.status(401).json({ error: "unauthorized" });
  const r = await pool.query(
    `SELECT id, company_name,
            contact_full_name AS name, contact_email AS email,
            contact_phone_e164 AS phone, country
       FROM bi_lenders
      WHERE id = $1
      LIMIT 1`,
    [v.id],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  return res.json(r.rows[0]);
});
router.get("/api/v1/lender/applications/mine", async (req: Request, res: Response) => {
  const v = verifyLenderJwt(req);
  if (!v) return res.status(401).json({ error: "unauthorized" });
  const r = await pool.query(
    `SELECT id, application_code, company_name, guarantor_name, status,
            loan_amount, pgi_limit, lender_name, core_inputs, created_at, updated_at
       FROM bi_applications
      WHERE lender_id = $1 OR created_by_lender_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
    [v.id],
  );
  return res.json({ applications: r.rows });
});

export default router;
