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

// BI_SERVER_BLOCK_v611_PASSKEY_REPAIR - standard registration. Browsers send an attestation
// object (CBOR), not a PEM key, so v601's registration could never succeed. Parse the
// attestation (format "none" is requested), check challenge / origin / RP ID / user presence,
// and turn the COSE public key into the PEM that verifyAssertion already uses.
export function cborDecode(buf: Buffer, offset = 0): { value: any; offset: number } {
  const first = buf[offset++];
  const major = first >> 5;
  const info = first & 0x1f;
  const readLen = (): number => {
    if (info < 24) return info;
    if (info === 24) return buf[offset++];
    if (info === 25) { const v = buf.readUInt16BE(offset); offset += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(offset); offset += 4; return v; }
    throw new Error("cbor_unsupported_length");
  };
  switch (major) {
    case 0: return { value: readLen(), offset };
    case 1: return { value: -1 - readLen(), offset };
    case 2: { const n = readLen(); return { value: Buffer.from(buf.subarray(offset, offset + n)), offset: offset + n }; }
    case 3: { const n = readLen(); return { value: buf.toString("utf8", offset, offset + n), offset: offset + n }; }
    case 4: { const n = readLen(); const arr: any[] = []; for (let i = 0; i < n; i++) { const r = cborDecode(buf, offset); arr.push(r.value); offset = r.offset; } return { value: arr, offset }; }
    case 5: { const n = readLen(); const m = new Map<any, any>(); for (let i = 0; i < n; i++) { const k = cborDecode(buf, offset); const v = cborDecode(buf, k.offset); m.set(k.value, v.value); offset = v.offset; } return { value: m, offset }; }
    case 7: if (info === 20) return { value: false, offset }; if (info === 21) return { value: true, offset }; if (info === 22) return { value: null, offset };
    // falls through
    default: throw new Error("cbor_unsupported_type");
  }
}

export function coseToPem(cose: Buffer): string {
  const m = cborDecode(cose).value as Map<number, any>;
  const kty = m.get(1);
  let key: crypto.KeyObject;
  if (kty === 2 && m.get(-1) === 1) key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: base64url(m.get(-2)), y: base64url(m.get(-3)) }, format: "jwk" });
  else if (kty === 3) key = crypto.createPublicKey({ key: { kty: "RSA", n: base64url(m.get(-1)), e: base64url(m.get(-2)) }, format: "jwk" });
  else throw new Error("unsupported_key_type");
  return key.export({ type: "spki", format: "pem" }).toString();
}

export function verifyAttestation(input: { clientDataJSON: string; attestationObject: string; credentialId: string; challenge: string; origin: string; rpId: string }) {
  parseClientData(input.clientDataJSON, "webauthn.create", input.challenge, input.origin);
  const att = cborDecode(fromBase64url(input.attestationObject)).value as Map<string, any>;
  const authData: Buffer = att.get("authData");
  if (!Buffer.isBuffer(authData) || authData.length < 55) throw new Error("invalid_authenticator_data");
  if (!crypto.timingSafeEqual(authData.subarray(0, 32), sha256(input.rpId))) throw new Error("invalid_rp_id");
  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error("user_not_present");
  if (!(flags & 0x40)) throw new Error("no_credential_data");
  let o = 37 + 16;
  const len = authData.readUInt16BE(o); o += 2;
  const credId = authData.subarray(o, o + len); o += len;
  if (base64url(credId) !== input.credentialId) throw new Error("credential_id_mismatch");
  const end = cborDecode(authData, o).offset;
  return { publicKeyPem: coseToPem(authData.subarray(o, end)), signCount: authData.readUInt32BE(33) };
}

/** The challenge the browser signed, read from clientDataJSON (verified again by the caller). */
export function challengeOf(clientDataJSON: string): string {
  try { return String(JSON.parse(fromBase64url(clientDataJSON).toString("utf8"))?.challenge ?? ""); } catch { return ""; }
}
