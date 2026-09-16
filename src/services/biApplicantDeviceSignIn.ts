// BI_SERVER_APPLICANT_FACE_ID_v300
// Applicant Face ID sign-in. The applicant's one-hour session is issued exactly
// as /applicants/otp/verify issues it; a device secret replaces the text code.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;

export const hashSecret = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const newSecret = () => crypto.randomBytes(32).toString("base64url");

export async function enrollApplicantDevice(query: Query, phone: string, label: string | null) {
  const secret = newSecret();
  const r = await query(
    `INSERT INTO bi_applicant_device_credentials (phone_e164, secret_hash, device_label) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [phone, hashSecret(secret), label ? label.slice(0, 80) : null],
  );
  return { credentialId: String(r.rows[0].id), secret };
}

export type ApplicantSignIn =
  | { ok: true; token: string; phone: string; contactId: string | null; secret: string }
  | { ok: false; reason: "invalid" | "expired" };

export async function signInApplicantDevice(query: Query, credentialId: string, secret: string, jwtSecret: string): Promise<ApplicantSignIn> {
  if (!/^[0-9a-f-]{36}$/i.test(credentialId) || !secret) return { ok: false, reason: "invalid" };
  const r = await query(
    `SELECT id::text AS id, phone_e164, secret_hash, expires_at, revoked_at FROM bi_applicant_device_credentials WHERE id::text = $1 LIMIT 1`,
    [credentialId],
  );
  const row = r.rows[0];
  const given = Buffer.from(hashSecret(secret));
  const stored = Buffer.from(String(row?.secret_hash ?? ""));
  if (!row || row.revoked_at || given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return { ok: false, reason: "invalid" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  const rotated = newSecret();
  const upd = await query(
    `UPDATE bi_applicant_device_credentials SET secret_hash = $2, last_used_at = now() WHERE id::text = $1 AND secret_hash = $3 AND revoked_at IS NULL RETURNING id`,
    [credentialId, hashSecret(rotated), row.secret_hash],
  );
  if (!upd.rows.length) return { ok: false, reason: "invalid" };
  const contact = await query(`SELECT id::text AS id FROM bi_contacts WHERE phone_e164 = $1 LIMIT 1`, [row.phone_e164]).catch(() => ({ rows: [] as any[] }));
  const contactId = contact.rows[0]?.id ?? null;
  const token = jwt.sign({ kind: "applicant", phone: row.phone_e164, ...(contactId ? { contactId } : {}) }, jwtSecret, { expiresIn: "1h" });
  return { ok: true, token, phone: row.phone_e164, contactId, secret: rotated };
}

export async function revokeApplicantDevices(query: Query, phone: string, credentialId: string | null) {
  const r = await query(
    `UPDATE bi_applicant_device_credentials SET revoked_at = now()
      WHERE phone_e164 = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id::text = $2) RETURNING id`,
    [phone, credentialId],
  );
  return r.rows.length;
}
