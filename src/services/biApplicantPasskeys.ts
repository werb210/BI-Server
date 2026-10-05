// BI_SERVER_BLOCK_v601 — applicant WebAuthn passkeys.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { base64url, challengeOf, verifyAssertion, verifyAttestation } from "./webauthnLite";

import { loggedFallback } from "../lib/queryFallback.js"; // BI_SERVER_LOGGED_FALLBACKS_v712
type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
const challenge = () => base64url(crypto.randomBytes(32));
const validCredential = (value: string) => typeof value === "string" && value.length > 5 && value.length < 2048;

export async function beginApplicantPasskeyRegistration(query: Query, phone: string, rpId: string) {
  const value = challenge();
  await query(`INSERT INTO bi_applicant_passkey_challenges (challenge, phone_e164, ceremony, expires_at) VALUES ($1,$2,'register',now()+interval '5 minutes')`, [value, phone]);
  return { challenge: value, rp: { id: rpId, name: "Boreal Insurance" }, user: { id: base64url(Buffer.from(phone)), name: phone, displayName: phone }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 300000, attestation: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" } };
}

export async function finishApplicantPasskeyRegistration(query: Query, phone: string, body: any, rpId = "client.boreal.insure", origin = "https://client.boreal.insure") {
  // BI_SERVER_BLOCK_v611_PASSKEY_REPAIR - verify the browser's attestation instead of trusting a client-sent key.
  const r = body?.response ?? body ?? {};
  const credentialId = String(body?.id ?? body?.credentialId ?? "");
  const clientDataJSON = String(r.clientDataJSON ?? "");
  const challengeValue = challengeOf(clientDataJSON);
  if (!validCredential(credentialId) || !challengeValue || !r.attestationObject) throw new Error("invalid_registration");
  const used = await query(`DELETE FROM bi_applicant_passkey_challenges WHERE challenge=$1 AND phone_e164=$2 AND ceremony='register' AND expires_at>now() RETURNING challenge`, [challengeValue, phone]);
  if (!used.rows.length) throw new Error("invalid_challenge");
  const verified = verifyAttestation({ clientDataJSON, attestationObject: String(r.attestationObject), credentialId, challenge: challengeValue, origin, rpId });
  const label = typeof body?.label === "string" ? body.label.slice(0, 80) : null;
  const transports = Array.isArray(r.transports) ? r.transports : Array.isArray(body?.transports) ? body.transports : [];
  await query(`INSERT INTO bi_applicant_passkeys (credential_id,phone_e164,public_key_pem,sign_count,label,transports) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (credential_id) DO NOTHING`, [credentialId, phone, verified.publicKeyPem, verified.signCount, label, JSON.stringify(transports)]);
  return { registered: true, credentialId };
}

export async function beginApplicantPasskeySignIn(query: Query, credentialId?: string) {
  const value = challenge();
  await query(`INSERT INTO bi_applicant_passkey_challenges (challenge, ceremony, expires_at) VALUES ($1,'authenticate',now()+interval '5 minutes')`, [value]);
  return { challenge: value, timeout: 300000, userVerification: "required", ...(credentialId ? { allowCredentials: [{ type: "public-key", id: credentialId }] } : {}) };
}

export async function finishApplicantPasskeySignIn(query: Query, body: any, jwtSecret: string, rpId: string, origin: string) {
  // BI_SERVER_BLOCK_v611_PASSKEY_REPAIR - accept the standard nested assertion; the challenge comes from clientDataJSON.
  const a = body?.response ?? body ?? {};
  const credentialId = String(body?.credentialId ?? body?.id ?? "");
  const challengeValue = String(body?.challenge ?? "") || challengeOf(String(a.clientDataJSON ?? ""));
  if (!validCredential(credentialId) || !challengeValue) throw new Error("invalid_assertion");
  const consumed = await query(`DELETE FROM bi_applicant_passkey_challenges WHERE challenge=$1 AND ceremony='authenticate' AND expires_at>now() RETURNING challenge`, [challengeValue]);
  if (!consumed.rows.length) throw new Error("invalid_challenge");
  const found = await query(`SELECT credential_id,phone_e164,public_key_pem,sign_count FROM bi_applicant_passkeys WHERE credential_id=$1 AND revoked_at IS NULL`, [credentialId]);
  const row = found.rows[0]; if (!row) throw new Error("unknown_credential");
  const verified = verifyAssertion({ clientDataJSON: String(a.clientDataJSON ?? ""), authenticatorData: String(a.authenticatorData ?? ""), signature: String(a.signature ?? ""), publicKeyPem: row.public_key_pem, challenge: challengeValue, origin, rpId, requireUserVerification: true });
  if (Number(row.sign_count) && verified.signCount && verified.signCount <= Number(row.sign_count)) throw new Error("counter_replay");
  await query(`UPDATE bi_applicant_passkeys SET sign_count=$2,last_used_at=now() WHERE credential_id=$1`, [credentialId, verified.signCount]);
  const contact = await query(`SELECT id::text AS id FROM bi_contacts WHERE phone_e164=$1 LIMIT 1`, [row.phone_e164]).catch(loggedFallback("biApplicantPasskeys", { rows: [] }));
  const contactId = contact.rows[0]?.id ?? null;
  return { token: jwt.sign({ kind: "applicant", phone: row.phone_e164, ...(contactId ? { contactId } : {}) }, jwtSecret, { expiresIn: "1h" }), phone: row.phone_e164, contactId };
}

export async function listApplicantPasskeys(query: Query, phone: string) {
  const r = await query(`SELECT credential_id AS "credentialId",label,created_at AS "createdAt",last_used_at AS "lastUsedAt",transports FROM bi_applicant_passkeys WHERE phone_e164=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, [phone]); return r.rows;
}
export async function removeApplicantPasskey(query: Query, phone: string, credentialId: string) {
  const r = await query(`UPDATE bi_applicant_passkeys SET revoked_at=now() WHERE phone_e164=$1 AND credential_id=$2 AND revoked_at IS NULL RETURNING credential_id`, [phone, credentialId]); return r.rows.length > 0;
}
