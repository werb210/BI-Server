// BI_SERVER_BLOCK_v221_LENDER_OTP_AND_ME_v1
// Lender OTP-SMS auth + identity + own-applications list for BI-Website /lender flow.
// Pattern mirrors referrer OTP routes; phone matched against bi_lenders.contact_phone_e164.
// Lender must be pre-provisioned (no auto-create — provisioning console is priority #4).
import express, { type Request, type Response } from "express";
import sgMail from "@sendgrid/mail";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { sendOtpSafe, verifyOtpSafe } from "../services/otpService";
import { normalizeE164 } from "../util/phoneE164";

const router = express.Router();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
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
  const identifierRaw = String(req.body?.identifier ?? req.body?.phone ?? "").trim();
  if (!identifierRaw) return res.status(400).json({ error: "missing_identifier" });
  const isEmail = identifierRaw.includes("@");

  if (!isEmail) {
    const phone = normalizeE164(identifierRaw);
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
  }

  const email = identifierRaw.toLowerCase();
  const r = await pool.query<{ id: string; contact_email: string | null }>(
    `SELECT id, contact_email FROM bi_lenders
      WHERE LOWER(contact_email) = $1 AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [email],
  );
  if (!r.rows[0]) return res.status(404).json({ error: "lender_not_provisioned" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await pool.query(
    `INSERT INTO bi_otp_codes(identifier, code, expires_at, attempts)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0)`,
    [email, code],
  );

  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM) {
    return res.status(502).json({ error: "otp_send_failed", detail: "sendgrid_not_configured" });
  }
  try {
    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM,
      subject: "Your Boreal Insurance login code",
      text: `Your Boreal Insurance login code is: ${code}`,
    });
  } catch (err) {
    return res.status(502).json({ error: "otp_send_failed", detail: String(err) });
  }
  return res.json({ ok: true });
});
router.post("/api/v1/lender/otp/verify", async (req: Request, res: Response) => {
  const identifierRaw = String(req.body?.identifier ?? req.body?.phone ?? "").trim();
  const code = String(req.body?.code ?? "").trim();
  if (!identifierRaw) return res.status(400).json({ error: "missing_identifier" });
  if (!code) return res.status(400).json({ error: "missing_code" });

  const isEmail = identifierRaw.includes("@");
  let lenderLookupIdentifier = "";

  if (!isEmail) {
    const phone = normalizeE164(identifierRaw);
    if (!phone) return res.status(400).json({ error: "invalid_phone" });
    const vr = await verifyOtpSafe(phone, code);
    if (!vr.ok) return res.status(502).json({ error: "otp_verify_failed", detail: vr.error });
    if (!vr.approved) return res.status(401).json({ error: "invalid_otp" });
    lenderLookupIdentifier = phone;
  } else {
    const email = identifierRaw.toLowerCase();
    lenderLookupIdentifier = email;
    const c = await pool.query<{ id: string }>(
      `SELECT id FROM bi_otp_codes
        WHERE identifier = $1 AND code = $2 AND expires_at > NOW() AND attempts < 5
        ORDER BY created_at DESC
        LIMIT 1`,
      [email, code],
    );
    if (!c.rows[0]) return res.status(401).json({ error: "invalid_otp" });
    await pool.query(`DELETE FROM bi_otp_codes WHERE identifier = $1`, [email]);
  }

  const r = await pool.query<{
    id: string; company_name: string | null;
    contact_full_name: string | null; contact_email: string | null;
  }>(
    `SELECT id, company_name, contact_full_name, contact_email
       FROM bi_lenders
      WHERE ${isEmail ? "LOWER(contact_email) = $1" : "contact_phone_e164 = $1"} AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [lenderLookupIdentifier],
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
