// BI_SERVER_BLOCK_v611 - passkeys end to end with a simulated authenticator.
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { beginApplicantPasskeyRegistration, beginApplicantPasskeySignIn, finishApplicantPasskeyRegistration, finishApplicantPasskeySignIn } from "../biApplicantPasskeys";

const RP = "client.boreal.insure";
const ORIGIN = "https://client.boreal.insure";
const PHONE = "+17805551212";
const SECRET = "test-shared-secret-min-10";

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
}
function enc(v: any): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)])]);
  throw new Error("enc");
}
const b64 = (b: Buffer) => b.toString("base64url");

function authenticator(origin = ORIGIN) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as any;
  const credId = crypto.randomBytes(16);
  const cose = enc(new Map<number, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const rpHash = crypto.createHash("sha256").update(RP).digest();
  let counter = 0;
  const cdj = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin }));
  return {
    id: b64(credId),
    create(challenge: string) {
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      const att = enc(new Map<string, any>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: b64(credId), rawId: b64(credId), type: "public-key", response: { clientDataJSON: b64(cdj("webauthn.create", challenge)), attestationObject: b64(att), transports: ["internal"] } };
    },
    get(challenge: string, tamper = false) {
      counter += 1;
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), c]);
      const clientData = cdj("webauthn.get", challenge);
      const sig = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(clientData).digest()]), privateKey);
      if (tamper) sig[sig.length - 1] ^= 1;
      return { id: b64(credId), rawId: b64(credId), type: "public-key", response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(sig), userHandle: null } };
    },
  };
}

function db() {
  const challenges: any[] = []; const keys: any[] = [];
  const query = vi.fn(async (sql: string, p: any[]) => {
    if (sql.startsWith("INSERT INTO bi_applicant_passkey_challenges")) { challenges.push({ challenge: p[0], phone: sql.includes("'register'") ? p[1] : null, ceremony: sql.includes("'register'") ? "register" : "authenticate" }); return { rows: [] }; }
    if (sql.startsWith("DELETE FROM bi_applicant_passkey_challenges")) {
      const cer = sql.includes("'register'") ? "register" : "authenticate";
      const i = challenges.findIndex((c) => c.challenge === p[0] && c.ceremony === cer && (cer === "authenticate" || c.phone === p[1]));
      if (i < 0) return { rows: [] };
      challenges.splice(i, 1); return { rows: [{ challenge: p[0] }] };
    }
    if (sql.startsWith("INSERT INTO bi_applicant_passkeys")) { keys.push({ credential_id: p[0], phone_e164: p[1], public_key_pem: p[2], sign_count: p[3] }); return { rows: [] }; }
    if (sql.includes("FROM bi_applicant_passkeys WHERE credential_id")) return { rows: keys.filter((k) => k.credential_id === p[0]) };
    if (sql.startsWith("UPDATE bi_applicant_passkeys SET sign_count")) { const k = keys.find((x) => x.credential_id === p[0]); if (k) k.sign_count = p[1]; return { rows: [] }; }
    if (sql.includes("FROM bi_contacts")) return { rows: [{ id: "contact-7" }] };
    return { rows: [] };
  });
  return { query, keys };
}

describe("BI passkeys - standard browser payloads", () => {
  it("registers from a real attestation and signs in with the nested assertion", async () => {
    const { query, keys } = db();
    const dev = authenticator();
    const reg: any = await beginApplicantPasskeyRegistration(query as any, PHONE, RP);
    expect(await finishApplicantPasskeyRegistration(query as any, PHONE, dev.create(reg.challenge), RP, ORIGIN)).toEqual({ registered: true, credentialId: dev.id });
    expect(keys[0].public_key_pem).toContain("BEGIN PUBLIC KEY");
    const lo: any = await beginApplicantPasskeySignIn(query as any);
    const r: any = await finishApplicantPasskeySignIn(query as any, dev.get(lo.challenge), SECRET, RP, ORIGIN);
    expect(jwt.verify(r.token, SECRET)).toMatchObject({ kind: "applicant", phone: PHONE, contactId: "contact-7" });
    expect(keys[0].sign_count).toBe(1);
    await expect(finishApplicantPasskeySignIn(query as any, dev.get(lo.challenge), SECRET, RP, ORIGIN)).rejects.toThrow("invalid_challenge");
  });

  it("rejects a wrong origin, a tampered signature and a reused registration challenge", async () => {
    const { query } = db();
    const dev = authenticator();
    const reg: any = await beginApplicantPasskeyRegistration(query as any, PHONE, RP);
    await expect(finishApplicantPasskeyRegistration(query as any, PHONE, authenticator("https://evil.example").create(reg.challenge), RP, ORIGIN)).rejects.toThrow();
    const reg2: any = await beginApplicantPasskeyRegistration(query as any, PHONE, RP);
    await finishApplicantPasskeyRegistration(query as any, PHONE, dev.create(reg2.challenge), RP, ORIGIN);
    await expect(finishApplicantPasskeyRegistration(query as any, PHONE, dev.create(reg2.challenge), RP, ORIGIN)).rejects.toThrow("invalid_challenge");
    const lo: any = await beginApplicantPasskeySignIn(query as any);
    await expect(finishApplicantPasskeySignIn(query as any, dev.get(lo.challenge, true), SECRET, RP, ORIGIN)).rejects.toThrow("invalid_signature");
  });

  it("serves the paths BI-Client calls", () => {
    const routes = readFileSync("src/routes/biApplicantPasskeyRoutes.ts", "utf8");
    for (const p of ["/applicants/passkeys/registration-options", "/applicants/passkeys/register", "/applicants/passkeys/authentication-options", "/applicants/passkeys/authenticate"]) expect(routes).toContain(`"${p}"`);
  });
});

