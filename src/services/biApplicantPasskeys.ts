// BI_SERVER_BLOCK_v601 — applicant WebAuthn passkeys.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { base64url, verifyAssertion } from "./webauthnLite";

type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
const challenge = () => base64url(crypto.randomBytes(32));
const validCredential = (value: string) => typeof value === "string" && value.length > 5 && value.length < 2048;

export async function beginApplicantPasskeyRegistration(query: Query, phone: string, rpId: string) {
  const value = challenge();
  await query(`INSERT INTO bi_applicant_passkey_challenges (challenge, phone_e164, ceremony, expires_at) VALUES ($1,$2,'register',now()+interval '5 minutes')`, [value, phone]);
  return { challenge: value, rp: { id: rpId, name: "Boreal Insurance" }, user: { id: base64url(Buffer.from(phone)), name: phone, displayName: phone }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 300000, attestation: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" } };
}

export async function finishApplicantPasskeyRegistration(query: Query, phone: string, body: any) {
  const credentialId = String(body?.credentialId ?? body?.id ?? "");
  const publicKey = String(body?.publicKeyPem ?? body?.publicKey ?? "");
  const challengeValue = String(body?.challenge ?? "");
  if (!validCredential(credentialId) || !publicKey.includes("PUBLIC KEY") || !challengeValue) throw new Error("invalid_registration");
  const used = await query(`DELETE FROM bi_applicant_passkey_challenges WHERE challenge=$1 AND phone_e164=$2 AND ceremony='register' AND expires_at>now() RETURNING challenge`, [challengeValue, phone]);
  if (!used.rows.length) throw new Error("invalid_challenge");
  const label = typeof body?.label === "string" ? body.label.slice(0, 80) : null;
  await query(`INSERT INTO bi_applicant_passkeys (credential_id,phone_e164,public_key_pem,label,transports) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (credential_id) DO NOTHING`, [credentialId, phone, publicKey, label, JSON.stringify(Array.isArray(body?.transports) ? body.transports : [])]);
  return { registered: true, credentialId };
}

export async function beginApplicantPasskeySignIn(query: Query, credentialId?: string) {
  const value = challenge();
  await query(`INSERT INTO bi_applicant_passkey_challenges (challenge, ceremony, expires_at) VALUES ($1,'authenticate',now()+interval '5 minutes')`, [value]);
  return { challenge: value, timeout: 300000, userVerification: "required", ...(credentialId ? { allowCredentials: [{ type: "public-key", id: credentialId }] } : {}) };
}

export async function finishApplicantPasskeySignIn(query: Query, body: any, jwtSecret: string, rpId: string, origin: string) {
  const credentialId = String(body?.credentialId ?? body?.id ?? "");
  const challengeValue = String(body?.challenge ?? "");
  if (!validCredential(credentialId) || !challengeValue) throw new Error("invalid_assertion");
  const consumed = await query(`DELETE FROM bi_applicant_passkey_challenges WHERE challenge=$1 AND ceremony='authenticate' AND expires_at>now() RETURNING challenge`, [challengeValue]);
  if (!consumed.rows.length) throw new Error("invalid_challenge");
  const found = await query(`SELECT credential_id,phone_e164,public_key_pem,sign_count FROM bi_applicant_passkeys WHERE credential_id=$1 AND revoked_at IS NULL`, [credentialId]);
  const row = found.rows[0]; if (!row) throw new Error("unknown_credential");
  const verified = verifyAssertion({ clientDataJSON: String(body.clientDataJSON ?? ""), authenticatorData: String(body.authenticatorData ?? ""), signature: String(body.signature ?? ""), publicKeyPem: row.public_key_pem, challenge: challengeValue, origin, rpId, requireUserVerification: true });
  if (Number(row.sign_count) && verified.signCount && verified.signCount <= Number(row.sign_count)) throw new Error("counter_replay");
  await query(`UPDATE bi_applicant_passkeys SET sign_count=$2,last_used_at=now() WHERE credential_id=$1`, [credentialId, verified.signCount]);
  const contact = await query(`SELECT id::text AS id FROM bi_contacts WHERE phone_e164=$1 LIMIT 1`, [row.phone_e164]).catch(() => ({ rows: [] }));
  const contactId = contact.rows[0]?.id ?? null;
  return { token: jwt.sign({ kind: "applicant", phone: row.phone_e164, ...(contactId ? { contactId } : {}) }, jwtSecret, { expiresIn: "1h" }), phone: row.phone_e164, contactId };
}

export async function listApplicantPasskeys(query: Query, phone: string) {
  const r = await query(`SELECT credential_id AS "credentialId",label,created_at AS "createdAt",last_used_at AS "lastUsedAt",transports FROM bi_applicant_passkeys WHERE phone_e164=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, [phone]); return r.rows;
}
export async function removeApplicantPasskey(query: Query, phone: string, credentialId: string) {
  const r = await query(`UPDATE bi_applicant_passkeys SET revoked_at=now() WHERE phone_e164=$1 AND credential_id=$2 AND revoked_at IS NULL RETURNING credential_id`, [phone, credentialId]); return r.rows.length > 0;
}
