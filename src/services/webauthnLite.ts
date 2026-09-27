import crypto from "node:crypto";

export const base64url = (value: Buffer | Uint8Array) => Buffer.from(value).toString("base64url");
export const fromBase64url = (value: string) => Buffer.from(value, "base64url");
export const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest();

export function parseClientData(encoded: string, expectedType: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
  let raw: Buffer;
  let data: any;
  try { raw = fromBase64url(encoded); data = JSON.parse(raw.toString("utf8")); } catch { throw new Error("invalid_client_data"); }
  if (data.type !== expectedType || data.challenge !== challenge || data.origin !== origin) throw new Error("invalid_client_data");
  return { raw, data };
}

export function parseAuthenticatorData(encoded: string, rpId: string) {
  const raw = fromBase64url(encoded);
  if (raw.length < 37) throw new Error("invalid_authenticator_data");
  if (!crypto.timingSafeEqual(raw.subarray(0, 32), sha256(rpId))) throw new Error("invalid_rp_id");
  const flags = raw[32];
  if (!(flags & 0x01)) throw new Error("user_not_present");
  return { raw, flags, signCount: raw.readUInt32BE(33) };
}

export function verifyAssertion(input: { clientDataJSON: string; authenticatorData: string; signature: string; publicKeyPem: string; challenge: string; origin: string; rpId: string; requireUserVerification?: boolean }) {
  const client = parseClientData(input.clientDataJSON, "webauthn.get", input.challenge, input.origin);
  const auth = parseAuthenticatorData(input.authenticatorData, input.rpId);
  if (input.requireUserVerification && !(auth.flags & 0x04)) throw new Error("user_not_verified");
  const signed = Buffer.concat([auth.raw, sha256(client.raw)]);
  if (!crypto.verify("sha256", signed, input.publicKeyPem, fromBase64url(input.signature))) throw new Error("invalid_signature");
  return { signCount: auth.signCount, userVerified: Boolean(auth.flags & 0x04) };
}
