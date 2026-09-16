// BI_SERVER_APPLICANT_FACE_ID_v300
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { enrollApplicantDevice, hashSecret, revokeApplicantDevices, signInApplicantDevice } from "../services/biApplicantDeviceSignIn";

const SECRET = "test-secret-123";
const ID = "44444444-4444-4444-4444-444444444444";

function store() {
  const rows = new Map<string, any>();
  const query = vi.fn(async (sql: string, p: any[]) => {
    if (sql.startsWith("INSERT INTO bi_applicant_device_credentials")) { rows.set(ID, { id: ID, phone_e164: p[0], secret_hash: p[1], expires_at: new Date(Date.now() + 1e9), revoked_at: null }); return { rows: [{ id: ID }] }; }
    if (sql.startsWith("SELECT id::text AS id, phone_e164")) return { rows: rows.has(p[0]) ? [rows.get(p[0])] : [] };
    if (sql.startsWith("UPDATE bi_applicant_device_credentials SET secret_hash")) { const r = rows.get(p[0]); if (!r || r.secret_hash !== p[2] || r.revoked_at) return { rows: [] }; r.secret_hash = p[1]; return { rows: [{ id: ID }] }; }
    if (sql.startsWith("UPDATE bi_applicant_device_credentials SET revoked_at")) { const r = rows.get(ID); if (r) r.revoked_at = new Date(); return { rows: r ? [{ id: ID }] : [] }; }
    if (sql.includes("FROM bi_contacts")) return { rows: [{ id: "contact-1" }] };
    return { rows: [] };
  });
  return { rows, query };
}

describe("applicant Face ID sign-in", () => {
  it("issues the same one-hour applicant session as a text code and rotates the secret", async () => {
    const { rows, query } = store();
    const { credentialId, secret } = await enrollApplicantDevice(query as any, "+17805551212", "iphone");
    expect(rows.get(ID).secret_hash).toBe(hashSecret(secret));
    const r = await signInApplicantDevice(query as any, credentialId, secret, SECRET);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const claims = jwt.verify(r.token, SECRET) as any;
    expect(claims).toMatchObject({ kind: "applicant", phone: "+17805551212", contactId: "contact-1" });
    expect(claims.exp - claims.iat).toBe(3600);
    expect((await signInApplicantDevice(query as any, credentialId, secret, SECRET)).ok).toBe(false);
  });

  it("refuses wrong, expired and revoked credentials", async () => {
    const { rows, query } = store();
    const { credentialId, secret } = await enrollApplicantDevice(query as any, "+17805551212", null);
    expect(await signInApplicantDevice(query as any, credentialId, "nope", SECRET)).toEqual({ ok: false, reason: "invalid" });
    rows.get(ID).expires_at = new Date(Date.now() - 1);
    expect(await signInApplicantDevice(query as any, credentialId, secret, SECRET)).toEqual({ ok: false, reason: "expired" });
    rows.get(ID).expires_at = new Date(Date.now() + 1e9);
    expect(await revokeApplicantDevices(query as any, "+17805551212", credentialId)).toBe(1);
    expect((await signInApplicantDevice(query as any, credentialId, secret, SECRET)).ok).toBe(false);
  });

  it("is mounted next to the applicant OTP routes", () => {
    expect(readFileSync("src/server.ts", "utf-8")).toContain('app.use("/api/v1", biCors, biApplicantDeviceSignInRoutes);');
  });
});
