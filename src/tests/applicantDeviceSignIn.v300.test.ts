// BI_SERVER_APPLICANT_FACE_ID_v300
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const dbQuery = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => dbQuery(...a),
    connect: async () => ({ query: (...a: unknown[]) => dbQuery(...a), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../server";
import { verifyBiToken } from "../platform/serviceTokens";
import { enrollApplicantDevice, hashSecret, revokeApplicantDevices, signInApplicantDevice } from "../services/biApplicantDeviceSignIn";

// v789: tokens are signed and verified with the suite's JWT_SECRET, never a literal.
const SECRET = process.env.JWT_SECRET as string;
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
    const claims = verifyBiToken(r.token, SECRET) as any;
    expect(claims).toMatchObject({ kind: "applicant", phone: "+17805551212", contactId: "contact-1" });
    // v789: signed through signBiToken (HS256, BI issuer and audience).
    expect(claims).toMatchObject({ iss: "bi-server", aud: "bi-server" });
    expect((jwt.decode(r.token, { complete: true }) as any).header.alg).toBe("HS256");
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

  // v789 [5]/[37]: was a grep of server.ts; now a sign-in through the real app,
  // cross-origin from the BI website like the OTP routes.
  it("is mounted next to the applicant OTP routes", async () => {
    const { query } = store();
    const { credentialId, secret } = await enrollApplicantDevice(query as any, "+17805551212", "iphone");
    dbQuery.mockImplementation((sql: string, p: any[]) => query(sql, p));
    const r = await request(app)
      .post("/api/v1/applicants/device-sign-in")
      .set("Origin", "https://www.boreal.insure")
      .send({ credentialId, secret });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("https://www.boreal.insure");
    expect(verifyBiToken(r.body.token, SECRET)).toMatchObject({ kind: "applicant", phone: "+17805551212" });
    const bad = await request(app).post("/api/v1/applicants/device-sign-in").send({ credentialId, secret: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: "device_sign_in_invalid" });
  });
});

// BI_SERVER_DEVICE_SIGN_IN_KEYGEN_v305
describe("device sign-in rate limit", () => {
  it("keys by client address with the Azure ip:port handled", () => {
    expect(readFileSync("src/routes/biApplicantDeviceSignInRoutes.ts", "utf-8")).toContain("keyGenerator: rateLimitKeyFromRequest");
  });
});
