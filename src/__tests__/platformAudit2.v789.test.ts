// BI_SERVER_v789_AUDIT2 - behaviour tests for the platform items of audit round 2:
// [4][71] tokens, [54] header redaction, [64] error bodies, [65] CORS, [67] public
// NAICS, [69] build/docs/metrics auth, [70] idempotency, [74] PGI mode log.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql } from "./helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../db", () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: async () => ({ query: (...args: unknown[]) => queryMock(...args), release: () => undefined }),
    end: async () => undefined,
  },
  runMigrations: async () => undefined,
}));

import app, { PGI_STUB_UNSET_IN_PRODUCTION_WARNING } from "../server";
import { requireAuth } from "../platform/auth";
import {
  signBiToken,
  verifyBiToken,
  signServiceTokenForBf,
  verifyServiceToken,
  requireBfServiceToken,
} from "../platform/serviceTokens";
import { getStaffVerifySecrets } from "../platform/jwtSecret";
import { redactHeaders } from "../utils/httpLogger";
import { errorHandler } from "../platform/errorHandler";
import { apiErrorBoundary } from "../middleware/apiErrorBoundary";
import { isAllowedOrigin } from "../platform/corsOrigins";
import { requestId } from "../platform/requestId";
import { idempotency, _idempotencyStore, IDEMPOTENCY_MAX_ENTRIES } from "../platform/idempotency";

const SECRET = () => process.env.JWT_SECRET as string;
const staffToken = (claims: Record<string, unknown> = {}) =>
  jwt.sign({ sub: "staff-1", role: "Admin", ...claims }, SECRET());

const saved: Record<string, string | undefined> = {};
function setEnv(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([]));
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

describe("[4][71] token issuer, audience and algorithms", () => {
  it("BI-signed tokens carry iss bi-server and aud bi-server", () => {
    const t = signBiToken({ kind: "applicant", phone: "+15875550000" }, "1h");
    const claims = jwt.decode(t) as Record<string, unknown>;
    expect(claims.iss).toBe("bi-server");
    expect(claims.aud).toBe("bi-server");
    expect(verifyBiToken(t, SECRET())?.phone).toBe("+15875550000");
  });

  it("service tokens BI sends to BF-Server carry aud bf-server", () => {
    const claims = jwt.decode(signServiceTokenForBf()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: "bi-server", aud: "bf-server", kind: "service", source: "bi-server" });
  });

  it("rejects a token whose aud is present and is not bi-server; accepts no aud", () => {
    expect(verifyBiToken(jwt.sign({ a: 1, aud: "bf-server" }, SECRET()), SECRET())).toBeNull();
    expect(verifyBiToken(jwt.sign({ a: 1, aud: ["x", "bi-server"] }, SECRET()), SECRET())).not.toBeNull();
    expect(verifyBiToken(jwt.sign({ a: 1 }, SECRET()), SECRET())).not.toBeNull();
  });

  it("pins HS256: an HS512 or unsigned token is rejected", () => {
    expect(verifyBiToken(jwt.sign({ a: 1 }, SECRET(), { algorithm: "HS512" }), SECRET())).toBeNull();
    const none = jwt.sign({ a: 1 }, "", { algorithm: "none" } as jwt.SignOptions);
    expect(verifyBiToken(none, SECRET())).toBeNull();
  });

  it("staff routes reject a staff token with a foreign audience", async () => {
    const t = jwt.sign({ sub: "s", role: "Admin", aud: "bf-client" }, SECRET());
    const r = await request(app).get("/api/v1/bi/applications").set("Authorization", `Bearer ${t}`);
    expect(r.status).toBe(401);
  });

  it("staff verification always accepts JWT_SECRET; BI_STAFF_JWT_SECRET is only an extra secret", async () => {
    setEnv("BI_STAFF_JWT_SECRET", "a-different-staff-secret-123");
    expect(getStaffVerifySecrets()).toEqual([SECRET(), "a-different-staff-secret-123"]);
    const viaShared = await request(app).get("/api/v1/bi/_int/build").set("Authorization", `Bearer ${staffToken()}`);
    expect(viaShared.status).toBe(200);
    const viaStaff = jwt.sign({ sub: "s", role: "Admin" }, "a-different-staff-secret-123");
    const r2 = await request(app).get("/api/v1/bi/_int/build").set("Authorization", `Bearer ${viaStaff}`);
    expect(r2.status).toBe(200);
  });

  describe("BI_SERVICE_JWT_SECRET", () => {
    const guarded = express();
    guarded.get("/staff", requireAuth, (_req, res) => res.json({ ok: true }));
    guarded.get("/svc", requireBfServiceToken, (_req, res) => res.json({ ok: true }));

    it("unset: service tokens signed with JWT_SECRET pass", async () => {
      setEnv("BI_SERVICE_JWT_SECRET", undefined);
      const t = jwt.sign({ kind: "service", source: "bf-server" }, SECRET());
      expect(verifyServiceToken(t)).not.toBeNull();
      expect((await request(guarded).get("/staff").set("Authorization", `Bearer ${t}`)).status).toBe(200);
      expect((await request(guarded).get("/svc").set("Authorization", `Bearer ${t}`)).status).toBe(200);
    });

    it("set: only BI_SERVICE_JWT_SECRET-signed service tokens pass; JWT_SECRET-signed ones are rejected", async () => {
      setEnv("BI_SERVICE_JWT_SECRET", "dedicated-service-secret-123");
      const old = jwt.sign({ kind: "service", source: "bf-server" }, SECRET());
      const fresh = jwt.sign({ kind: "service", source: "bf-server" }, "dedicated-service-secret-123");
      expect(verifyServiceToken(old)).toBeNull();
      expect(verifyServiceToken(fresh)).not.toBeNull();
      expect((await request(guarded).get("/staff").set("Authorization", `Bearer ${old}`)).status).toBe(401);
      expect((await request(guarded).get("/staff").set("Authorization", `Bearer ${fresh}`)).status).toBe(200);
      expect((await request(guarded).get("/svc").set("Authorization", `Bearer ${old}`)).status).toBe(403);
      expect((await request(guarded).get("/svc").set("Authorization", `Bearer ${fresh}`)).status).toBe(200);
      // staff tokens keep using JWT_SECRET
      expect((await request(guarded).get("/staff").set("Authorization", `Bearer ${staffToken()}`)).status).toBe(200);
      // outbound service tokens are signed with the dedicated secret
      expect(() => jwt.verify(signServiceTokenForBf(), "dedicated-service-secret-123")).not.toThrow();
    });

    it("service-only guard: staff token 403, no token 401, other service source 403", async () => {
      setEnv("BI_SERVICE_JWT_SECRET", undefined);
      expect((await request(guarded).get("/svc")).status).toBe(401);
      expect((await request(guarded).get("/svc").set("Authorization", `Bearer ${staffToken()}`)).status).toBe(403);
      const maya = jwt.sign({ kind: "service", source: "maya-service" }, SECRET());
      expect((await request(guarded).get("/svc").set("Authorization", `Bearer ${maya}`)).status).toBe(403);
    });
  });
});

describe("[54] request header redaction", () => {
  it("redacts credentials and any token/key/secret header", () => {
    const out = redactHeaders({
      authorization: "Bearer abc",
      "x-api-key": "bk_live_x",
      "x-service-token": "s",
      "x-job-token": "j",
      "x-backend-token": "b",
      "x-custom-secret": "c",
      "x-refresh-token": "r",
      "x-partner-key": "k",
      cookie: "sid=1",
      "user-agent": "curl",
      accept: "*/*",
    });
    for (const k of ["authorization", "x-api-key", "x-service-token", "x-job-token", "x-backend-token", "x-custom-secret", "x-refresh-token", "x-partner-key", "cookie"]) {
      expect(out[k]).toBe("[redacted]");
    }
    expect(out["user-agent"]).toBe("curl");
    expect(out.accept).toBe("*/*");
  });
});

describe("[64] error bodies never carry err.message", () => {
  const boom = express();
  boom.use(requestId);
  boom.get("/api/v1/x", () => {
    throw Object.assign(new Error('relation "bi_secret_table" does not exist'), { code: "42P01" });
  });
  boom.get("/api/v1/y", () => {
    throw Object.assign(new Error("bad thing at /home/app/file.ts"), { status: 400, code: "bad_input" });
  });
  boom.get("/plain", () => {
    throw new Error("SELECT * FROM secrets");
  });
  boom.use(apiErrorBoundary);
  boom.use(errorHandler);

  it("apiErrorBoundary returns a code, generic message and requestId", async () => {
    const r = await request(boom).get("/api/v1/x");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("internal_error");
    expect(JSON.stringify(r.body)).not.toContain("bi_secret_table");
    expect(r.body).toHaveProperty("requestId");
    const r2 = await request(boom).get("/api/v1/y");
    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe("bad_input");
    expect(JSON.stringify(r2.body)).not.toContain("/home/app");
  });

  it("errorHandler returns a code, generic message and requestId", async () => {
    const r = await request(boom).get("/plain");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("internal_error");
    expect(JSON.stringify(r.body)).not.toContain("secrets");
  });
});

describe("[65] CORS exact origins", () => {
  const allowed = [
    "https://staff.boreal.financial",
    "https://boreal.insure",
    "https://www.boreal.insure",
    "capacitor://localhost",
    "https://localhost",
    "https://witty-moss-0886d220f.7.azurestaticapps.net",
    "https://delightful-sand-05a55580f.7.azurestaticapps.net",
  ];
  it.each(allowed)("allows %s", async (origin) => {
    const r = await request(app).options("/api/v1/otp/request").set("Origin", origin).set("Access-Control-Request-Method", "POST");
    expect(r.headers["access-control-allow-origin"]).toBe(origin);
  });

  it.each([
    "https://evil-app-123.4.azurestaticapps.net",
    "https://evil.example.com",
    "ionic://localhost",
    "https://staff.boreal.financial.evil.com",
  ])("refuses %s and never reflects it", async (origin) => {
    const r = await request(app).options("/api/v1/otp/request").set("Origin", origin).set("Access-Control-Request-Method", "POST");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    expect(JSON.stringify(r.body ?? {})).not.toContain(origin);
  });

  it("http://localhost only outside production", () => {
    setEnv("NODE_ENV", "production");
    expect(isAllowedOrigin("http://localhost:5173")).toBe(false);
    setEnv("NODE_ENV", "test");
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });

  it("CORS_ALLOWED_ORIGINS adds exact origins only (no wildcards)", () => {
    setEnv("CORS_ALLOWED_ORIGINS", "https://client.boreal.insure, https://*.azurestaticapps.net");
    expect(isAllowedOrigin("https://client.boreal.insure")).toBe(true);
    expect(isAllowedOrigin("https://x.1.azurestaticapps.net")).toBe(false);
  });

  it("apiErrorBoundary does not reflect an arbitrary Origin on errors", async () => {
    const boom = express();
    boom.get("/api/v1/z", () => { throw new Error("x"); });
    boom.use(apiErrorBoundary);
    const bad = await request(boom).get("/api/v1/z").set("Origin", "https://evil.example.com");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const good = await request(boom).get("/api/v1/z").set("Origin", "https://www.boreal.insure");
    expect(good.headers["access-control-allow-origin"]).toBe("https://www.boreal.insure");
  });
});

describe("[67] public NAICS lookup", () => {
  it("works without a token", async () => {
    queryMock.mockImplementation(answerBySql([["FROM naics_codes", { rows: [{ code: "236220", title: "Commercial building", country: "CA" }] }]]));
    const r = await request(app).get("/api/v1/bi/naics?q=2362");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain("236220");
  });

  it("is rate limited", async () => {
    let last = 200;
    for (let i = 0; i < 70; i += 1) {
      last = (await request(app).get("/api/v1/bi/naics?q=a").set("X-Forwarded-For", "203.0.113.77")).status;
    }
    expect(last).toBe(429);
  });
});

describe("[69] build, docs and metrics are not public", () => {
  it("/api/v1/_int/build and /api/v1/bi/_int/build need staff auth", async () => {
    expect((await request(app).get("/api/v1/_int/build")).status).toBe(401);
    expect((await request(app).get("/api/v1/bi/_int/build")).status).toBe(401);
    const applicant = jwt.sign({ kind: "applicant", phone: "+15875550000" }, SECRET());
    expect((await request(app).get("/api/v1/_int/build").set("Authorization", `Bearer ${applicant}`)).status).toBe(403);
    const ok = await request(app).get("/api/v1/_int/build").set("Authorization", `Bearer ${staffToken()}`);
    expect(ok.status).toBe(200);
    expect(ok.body.service).toBe("bi-server");
  });

  it("/docs needs staff auth", async () => {
    expect((await request(app).get("/docs/")).status).toBe(401);
    expect((await request(app).get("/docs/").set("Authorization", `Bearer ${staffToken()}`)).status).toBe(200);
  });

  it("/metrics is 404 without METRICS_TOKEN, 401 with a wrong bearer, 200 with the right one", async () => {
    setEnv("METRICS_TOKEN", undefined);
    expect((await request(app).get("/metrics")).status).toBe(404);
    setEnv("METRICS_TOKEN", "metrics-token-xyz");
    expect((await request(app).get("/metrics")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer nope")).status).toBe(401);
    const r = await request(app).get("/metrics").set("Authorization", "Bearer metrics-token-xyz");
    expect(r.status).toBe(200);
  });
});

describe("[70] idempotency", () => {
  function appWith(status: number) {
    const a = express();
    a.use(idempotency);
    a.post("/api/v1/thing", (_req, res) => res.status(status).json({ ok: status < 400 }));
    a.post("/api/v1/other", (_req, res) => res.status(200).json({ ok: true }));
    a.post("/api/v1/lender/applications", (_req, res) => res.status(201).json({ ok: true }));
    return a;
  }
  beforeEach(() => _idempotencyStore().clear());

  it("same caller + route + key is refused the second time", async () => {
    const a = appWith(200);
    const auth = `Bearer ${staffToken()}`;
    expect((await request(a).post("/api/v1/thing").set("Authorization", auth).set("Idempotency-Key", "k1")).status).toBe(200);
    expect((await request(a).post("/api/v1/thing").set("Authorization", auth).set("Idempotency-Key", "k1")).status).toBe(409);
  });

  it("is scoped per principal and per route", async () => {
    const a = appWith(200);
    const one = `Bearer ${staffToken({ sub: "staff-1" })}`;
    const two = `Bearer ${staffToken({ sub: "staff-2" })}`;
    expect((await request(a).post("/api/v1/thing").set("Authorization", one).set("Idempotency-Key", "k")).status).toBe(200);
    expect((await request(a).post("/api/v1/thing").set("Authorization", two).set("Idempotency-Key", "k")).status).toBe(200);
    expect((await request(a).post("/api/v1/other").set("Authorization", one).set("Idempotency-Key", "k")).status).toBe(200);
  });

  it("releases the key after a 5xx so a genuine retry works", async () => {
    const a = appWith(503);
    const auth = `Bearer ${staffToken()}`;
    expect((await request(a).post("/api/v1/thing").set("Authorization", auth).set("Idempotency-Key", "k5")).status).toBe(503);
    expect((await request(a).post("/api/v1/thing").set("Authorization", auth).set("Idempotency-Key", "k5")).status).toBe(503);
  });

  it("skips routes with persistent idempotency (lender application create)", async () => {
    const a = appWith(200);
    for (let i = 0; i < 2; i += 1) {
      expect((await request(a).post("/api/v1/lender/applications").set("X-API-Key", "bk_test_x").set("Idempotency-Key", "same")).status).toBe(201);
    }
  });

  it("is bounded (LRU, 10,000 entries)", () => {
    const store = _idempotencyStore();
    for (let i = 0; i < IDEMPOTENCY_MAX_ENTRIES + 50; i += 1) store.add(`k${i}`);
    expect(store.size).toBe(IDEMPOTENCY_MAX_ENTRIES);
    expect(store.has("k0")).toBe(false);
    expect(store.has(`k${IDEMPOTENCY_MAX_ENTRIES + 49}`)).toBe(true);
  });
});

describe("[74] PGI mode log", () => {
  it("describes live mode, which is what pgiAdapter does when USE_PGI_STUB is unset in production", () => {
    expect(PGI_STUB_UNSET_IN_PRODUCTION_WARNING).toContain("LIVE mode");
    expect(PGI_STUB_UNSET_IN_PRODUCTION_WARNING).not.toMatch(/treating as stub/i);
  });
});
