// BI_SERVER_v789 - lender application create: demo/bk_test_ stub path [49],
// API-key fall-through [50], active lender/contact check [52], Idempotency-Key [57].
// Mounted the way src/server.ts mounts them: biLenderApplicationCreate at the
// root, then biLenderApiRoutes at /api/v1 and /api/v1/bi, then
// biLenderApplicationDetail at the root.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  pgiSubmit: vi.fn(),
  pgiScore: vi.fn(),
  pgiUploadDocument: vi.fn(),
}));

vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => h.queryMock(...args) } }));
vi.mock("../../services/pgiAdapter", () => ({
  pgiSubmit: (...a: unknown[]) => h.pgiSubmit(...a),
  pgiScore: (...a: unknown[]) => h.pgiScore(...a),
  pgiUploadDocument: (...a: unknown[]) => h.pgiUploadDocument(...a),
}));
vi.mock("../../services/staffNotifyService", () => ({ notifyStaff: vi.fn(async () => undefined) }));

import biLenderApplicationCreate from "../biLenderApplicationCreate";
import biLenderApiRoutes from "../biLenderApiRoutes";
import biLenderApplicationDetail from "../biLenderApplicationDetail";
import { signBiToken } from "../../platform/serviceTokens";
import { resetLenderActiveCache } from "../../services/lenderActiveCache";

const LENDER_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const LIVE_KEY = "bk_live_aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_KEY = "bk_test_cccccccccccc.dddddddddddddddddddddddd";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(biLenderApplicationCreate);
  app.use("/api/v1", biLenderApiRoutes);
  app.use("/api/v1/bi", biLenderApiRoutes);
  app.use(biLenderApplicationDetail);
  return app;
}

function lenderJwt(extra: Record<string, unknown> = {}) {
  return signBiToken({ kind: "lender", id: LENDER_ID, user_id: CONTACT_ID, ...extra }, "1h", process.env.JWT_SECRET as string);
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    company_name: "Itest Co",
    guarantor: { name: "Itest Guarantor", dob: "1980-01-01", email: "g@itest.local", address: "125 Main St, Calgary, AB T2P 1A1", phone: "+15875550100", q_ca_id_type: "Driving Licence", q_ca_id_number: "AB-1234567" },
    business: { country: "CA", province: "AB", address: "125 Main St, Calgary, AB T2P 1A1", naics: "236220", start_date: "2022-05-03" },
    loan: { amount: 500000, pgi_limit: 400000, q_ca_loan_type: "Other Secured Loan" },
    financials: { revenue_last_year: 2000000, ebitda_last_year: 400000, total_debt: 300000, monthly_debt_service: 8000, collateral_value: 600000, enterprise_value: 1500000 },
    declarations: { section_1_a: "no", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "no" },
    co_guarantors: [],
    lender_name: "Itest Lender",
    ...over,
  };
}

type IdemRow = { id: string; key: string; response: unknown; created_at: Date };
let state: {
  lenderActive: boolean;
  contactActive: boolean;
  rowIsDemo: boolean;
  appInserts: number;
  idem: Map<string, IdemRow>;
};

function db() {
  return answerBySql([
    [/FROM bi_lenders l\s+LEFT JOIN bi_lender_login_contacts/, (_s: string, p: unknown[]) => ({
      rows: [{ lender_active: state.lenderActive, contact_active: p[1] ? state.contactActive : null }],
      rowCount: 1,
    })],
    ["INSERT INTO bi_idempotency_keys", (_s: string, p: unknown[]) => {
      const key = (p as string[]).join("|");
      if (state.idem.has(key)) return { rows: [], rowCount: 0 };
      const row: IdemRow = { id: crypto.randomUUID(), key, response: null, created_at: new Date() };
      state.idem.set(key, row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }],
    ["SELECT id, response, created_at FROM bi_idempotency_keys", (_s: string, p: unknown[]) => {
      const row = state.idem.get((p as string[]).join("|"));
      return { rows: row ? [{ id: row.id, response: row.response, created_at: row.created_at }] : [], rowCount: row ? 1 : 0 };
    }],
    ["UPDATE bi_idempotency_keys SET response", (_s: string, p: unknown[]) => {
      for (const row of state.idem.values()) if (row.id === p[0]) row.response = JSON.parse(String(p[1]));
      return { rows: [], rowCount: 1 };
    }],
    ["DELETE FROM bi_idempotency_keys", (_s: string, p: unknown[]) => {
      for (const [k, row] of state.idem) if (row.id === p[0] && row.response === null) state.idem.delete(k);
      return { rows: [], rowCount: 1 };
    }],
    ["FROM bi_lender_api_keys WHERE key_hash", (_s: string, p: unknown[]) => {
      if (p[0] === sha(LIVE_KEY)) return { rows: [{ lender_id: LENDER_ID, key_prefix: "bk_live_" }], rowCount: 1 };
      if (p[0] === sha(TEST_KEY)) return { rows: [{ lender_id: LENDER_ID, key_prefix: "bk_test_" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }],
    ["SELECT company_name, is_demo FROM bi_lenders", () => ({ rows: [{ company_name: "Acme Lending", is_demo: state.rowIsDemo }], rowCount: 1 })],
    ["INSERT INTO bi_applications", () => {
      state.appInserts += 1;
      return { rows: [{ id: `app-${state.appInserts}`, application_code: `CODE${state.appInserts}` }], rowCount: 1 };
    }],
    [/SELECT \* FROM bi_applications WHERE application_code/, { rows: [{ id: "app-9", application_code: "CODE9", status: "submitted" }], rowCount: 1 }],
  ]);
}

beforeEach(() => {
  resetLenderActiveCache();
  state = { lenderActive: true, contactActive: true, rowIsDemo: false, appInserts: 0, idem: new Map() };
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(db());
  h.pgiSubmit.mockReset();
  h.pgiSubmit.mockResolvedValue({ application_id: "PGI-LIVE-1", status: "received" });
  h.pgiScore.mockReset();
  h.pgiScore.mockResolvedValue({ score_id: "S-1", score: 80, decision: "approve", country: "CA", naics_code: "236220", created_at: new Date().toISOString() });
  h.pgiUploadDocument.mockReset();
});

describe("[49] demo sessions never take the live carrier path", () => {
  it("a non-demo lender JWT create submits to the carrier", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(r.status).toBe(201);
    expect(h.pgiSubmit).toHaveBeenCalledTimes(1);
    expect(r.body.pgi_application_id).toBe("PGI-LIVE-1");
  });

  it("a demo JWT (is_demo claim) uses the stub, never the live adapter", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt({ is_demo: true })}`).send(validBody());
    expect(r.status).toBe(201);
    expect(h.pgiSubmit).not.toHaveBeenCalled();
    expect(r.body.pgi_status).toBe("demo");
    expect(String(r.body.pgi_application_id)).toMatch(/^DEMO_/);
    const insert = callsMatching(h.queryMock, "INSERT INTO bi_applications")[0] as [string, unknown[]];
    expect(insert[1][10]).toBe(true); // is_demo stored
  });

  it("a lender whose row is is_demo uses the stub even without the claim", async () => {
    state.rowIsDemo = true;
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(r.status).toBe(201);
    expect(h.pgiSubmit).not.toHaveBeenCalled();
  });

  it("a demo JWT on the /api/v1/bi mount (API router) also uses the stub", async () => {
    const r = await request(buildApp()).post("/api/v1/bi/lender/applications").set("Authorization", `Bearer ${lenderJwt({ is_demo: true })}`).send(validBody());
    expect(r.status).toBe(201);
    expect(h.pgiSubmit).not.toHaveBeenCalled();
  });
});

describe("[50] API keys reach the API-key create handler", () => {
  it("bk_live_ key creates and submits live", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${LIVE_KEY}`).send(validBody());
    expect(r.status).toBe(201);
    expect(r.body.application_id).toBeTruthy();
    expect(h.pgiSubmit).toHaveBeenCalledTimes(1);
    expect(r.body.pgi_application_id).toBe("PGI-LIVE-1");
  });

  it("bk_test_ key creates on the stub path (README promise)", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("X-API-Key", TEST_KEY).send(validBody());
    expect(r.status).toBe(201);
    expect(h.pgiSubmit).not.toHaveBeenCalled();
    expect(String(r.body.pgi_application_id)).toMatch(/^DEMO_/);
    expect(r.body.pgi_status).toBe("demo");
  });

  it("an unknown key answers 401 and creates nothing", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", "Bearer bk_live_nope.nope").send(validBody());
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("invalid_api_key");
    expect(state.appInserts).toBe(0);
  });

  it("no credentials answers 401", async () => {
    const r = await request(buildApp()).post("/api/v1/lender/applications").send(validBody());
    expect(r.status).toBe(401);
    expect(state.appInserts).toBe(0);
  });
});

describe("[52] inactive lender / contact are rejected", () => {
  it("inactive lender: JWT create 403", async () => {
    state.lenderActive = false;
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("lender_inactive");
    expect(state.appInserts).toBe(0);
  });

  it("inactive contact: JWT create 403", async () => {
    state.contactActive = false;
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("contact_inactive");
    expect(state.appInserts).toBe(0);
  });

  it("inactive contact on the email-verify claim (contactId) is rejected too", async () => {
    state.contactActive = false;
    const token = signBiToken({ kind: "lender", id: LENDER_ID, contactId: CONTACT_ID }, "1h", process.env.JWT_SECRET as string);
    const r = await request(buildApp()).get("/api/v1/lender/applications/mine").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it("inactive lender: authLender JWT branch 403", async () => {
    state.lenderActive = false;
    const r = await request(buildApp()).get("/api/v1/lender/me").set("Authorization", `Bearer ${lenderJwt()}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("lender_inactive");
  });

  it("inactive lender: API key 403", async () => {
    state.lenderActive = false;
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${LIVE_KEY}`).send(validBody());
    expect(r.status).toBe(403);
    expect(state.appInserts).toBe(0);
  });

  it("inactive lender / contact: application detail 403, active 200", async () => {
    state.contactActive = false;
    const bad = await request(buildApp()).get("/api/v1/lender/applications/CODE9").set("Authorization", `Bearer ${lenderJwt()}`);
    expect(bad.status).toBe(403);
    resetLenderActiveCache();
    state.contactActive = true;
    const ok = await request(buildApp()).get("/api/v1/lender/applications/CODE9").set("Authorization", `Bearer ${lenderJwt()}`);
    expect(ok.status).toBe(200);
    expect(ok.body.application_code).toBe("CODE9");
  });

  it("the active check is cached: a second request within 30s does not query again", async () => {
    await request(buildApp()).get("/api/v1/lender/applications/mine").set("Authorization", `Bearer ${lenderJwt()}`);
    await request(buildApp()).get("/api/v1/lender/applications/mine").set("Authorization", `Bearer ${lenderJwt()}`);
    expect(callsMatching(h.queryMock, /FROM bi_lenders l\s+LEFT JOIN/)).toHaveLength(1);
  });

  it("a database error during the check answers 503 without leaking the error", async () => {
    h.queryMock.mockImplementation(async (sql: string) => {
      if (/FROM bi_lenders l/.test(sql)) throw new Error("relation secret_table does not exist");
      return { rows: [], rowCount: 0 };
    });
    const r = await request(buildApp()).get("/api/v1/lender/me").set("Authorization", `Bearer ${lenderJwt()}`);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("secret_table");
  });
});

describe("[57] Idempotency-Key on lender create", () => {
  for (const [label, auth] of [["JWT create", () => `Bearer ${lenderJwt()}`], ["API-key create", () => `Bearer ${LIVE_KEY}`]] as const) {
    it(`${label}: same key twice -> one insert, identical response`, async () => {
      const app = buildApp();
      const a = await request(app).post("/api/v1/lender/applications").set("Authorization", auth()).set("Idempotency-Key", "k-1").send(validBody());
      const b = await request(app).post("/api/v1/lender/applications").set("Authorization", auth()).set("Idempotency-Key", "k-1").send(validBody());
      expect(a.status).toBe(201);
      expect(b.status).toBe(a.status);
      expect(b.body).toEqual(a.body);
      expect(b.headers["idempotent-replayed"]).toBe("true");
      expect(state.appInserts).toBe(1);
      expect(h.pgiSubmit).toHaveBeenCalledTimes(1);
    });

    it(`${label}: a different key creates a new application`, async () => {
      const app = buildApp();
      const a = await request(app).post("/api/v1/lender/applications").set("Authorization", auth()).set("Idempotency-Key", "k-1").send(validBody());
      const b = await request(app).post("/api/v1/lender/applications").set("Authorization", auth()).set("Idempotency-Key", "k-2").send(validBody());
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(state.appInserts).toBe(2);
    });
  }

  it("a failed (non-2xx) response is not stored: the same key can be retried", async () => {
    const app = buildApp();
    const bad = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).set("Idempotency-Key", "k-3").send(validBody({ business: { province: "QC", naics: "236220", start_date: "2022-05-03" } }));
    expect(bad.status).toBe(400);
    expect(state.idem.size).toBe(0);
    const good = await request(app).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).set("Idempotency-Key", "k-3").send(validBody());
    expect(good.status).toBe(201);
    expect(state.appInserts).toBe(1);
  });

  it("the stored response is keyed by lender + key + route", async () => {
    await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).set("Idempotency-Key", "k-4").send(validBody());
    const insert = callsMatching(h.queryMock, "INSERT INTO bi_idempotency_keys")[0] as [string, unknown[]];
    expect(insert[1]).toEqual([LENDER_ID, "k-4", "POST /api/v1/lender/applications"]);
    const stored = [...state.idem.values()][0];
    expect((stored.response as { status: number }).status).toBe(201);
  });

  it("a key that is still being processed answers 409", async () => {
    state.idem.set([LENDER_ID, "k-5", "POST /api/v1/lender/applications"].join("|"), { id: "r-1", key: "", response: null, created_at: new Date() });
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).set("Idempotency-Key", "k-5").send(validBody());
    expect(r.status).toBe(409);
    expect(state.appInserts).toBe(0);
  });

  it("without the header nothing is persisted", async () => {
    await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(callsMatching(h.queryMock, "bi_idempotency_keys")).toHaveLength(0);
  });
});

describe("[10] carrier error text never reaches the response", () => {
  it("a failing carrier submit returns a code, not the provider text", async () => {
    h.pgiSubmit.mockRejectedValue(new Error("PGI submit failed: 500 upstream body secret-xyz"));
    const r = await request(buildApp()).post("/api/v1/lender/applications").set("Authorization", `Bearer ${lenderJwt()}`).send(validBody());
    expect(r.status).toBe(201);
    expect(r.body.pgi_error).toBe("carrier_submit_failed");
    expect(JSON.stringify(r.body)).not.toContain("secret-xyz");
  });
});
