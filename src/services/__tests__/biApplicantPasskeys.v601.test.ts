import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64url, sha256, verifyAssertion } from "../webauthnLite";
import { beginApplicantPasskeyRegistration, removeApplicantPasskey } from "../biApplicantPasskeys";

describe("applicant passkeys v601", () => {
  it("creates WebAuthn registration options and stores the challenge", async () => {
    const calls: any[] = []; const query = async (sql: string, params: unknown[]) => { calls.push([sql, params]); return { rows: [] }; };
    const result = await beginApplicantPasskeyRegistration(query, "+14165550100", "client.boreal.insure");
    expect(result.challenge).toMatch(/^[\w-]{40,}$/); expect(result.rp.id).toBe("client.boreal.insure"); expect(calls[0][1]).toEqual([result.challenge, "+14165550100"]);
  });
  it("verifies an assertion and reports its counter", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const challenge = base64url(crypto.randomBytes(32)); const clientRaw = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "https://client.boreal.insure" }));
    const auth = Buffer.alloc(37); sha256("client.boreal.insure").copy(auth); auth[32] = 5; auth.writeUInt32BE(7, 33);
    const signature = crypto.sign("sha256", Buffer.concat([auth, sha256(clientRaw)]), privateKey);
    expect(verifyAssertion({ clientDataJSON: base64url(clientRaw), authenticatorData: base64url(auth), signature: base64url(signature), publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), challenge, origin: "https://client.boreal.insure", rpId: "client.boreal.insure", requireUserVerification: true }).signCount).toBe(7);
  });
  it("scopes removal to the authenticated phone", async () => {
    const query = async (_sql: string, params: unknown[]) => ({ rows: params[0] === "+1" ? [{}] : [] });
    expect(await removeApplicantPasskey(query, "+1", "credential")).toBe(true);
  });
});
