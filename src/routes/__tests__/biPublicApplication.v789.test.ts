// BI_SERVER_v789 - public application link: ids, read masking, edit lock,
// guarantor phone lock, rate limit, upload limits and content sniffing,
// submit gates and no provider error text. Behaviour tests (db mocked).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));
const putMock = vi.fn();
vi.mock("../../lib/storage", () => ({ getStorage: () => ({ put: (...a: unknown[]) => putMock(...a) }) }));
vi.mock("../../services/ocrRunner", () => ({ runOcrForDocument: vi.fn().mockResolvedValue(undefined) }));
const scoreMock = vi.fn();
vi.mock("../../services/pgiAdapter", () => ({ pgiScore: (...a: unknown[]) => scoreMock(...a) }));
vi.mock("../../services/notifyBiClient", () => ({ notifyBiClient: vi.fn().mockResolvedValue({ channel: "push" }) }));

import router from "../biPublicApplicationRoutes";
import { generatePublicId, PUBLIC_ID_ALPHABET } from "../../util/publicId";

let ipSeq = 1;
/** A fresh public client IP per request so the 30/min limiter only bites where a test wants it. */
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
// Separate block for tests that drive the limiter.
const LIMIT_IP = "192.0.2.77";

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use(router);
  // A later router's route under /applications (like the staff score route on
  // the real /api/v1 mount) must not be counted by the public limiter.
  a.get("/applications/:id/activity", (_req, res) => res.json({ ok: true }));
  return a;
}

const consents = {
  electronic_signature: true, info_accurate: true, business_solvent: true,
  no_undisclosed_events: true, data_use: true, credit_pull: true, coverage_understood: true,
};
const fullRow = {
  id: "00000000-0000-0000-0000-0000000000a1", public_id: "ABCDEFGH", score_decision: "approve", score_stale: false,
  status: "created", source: "public",
  guarantor_name: "Jane", guarantor_email: "jane@example.com", guarantor_dob: "1980-01-01",
  guarantor_address: "1 Main", guarantor_phone: "+14165551234", business_name: "Acme", business_address: "2 King",
  lender_name: "Bank", loan_funding_date: "2026-06-01", policy_start_date: "2026-06-01",
  personally_guaranteeing: true, consents, loan_amount: 500000, pgi_limit: 400000,
};

beforeEach(() => {
  queryMock.mockReset();
  putMock.mockReset().mockResolvedValue({ blobName: "b", url: "u", hash: "h", sizeBytes: 10 });
  scoreMock.mockReset();
});

describe("public ids", () => {
  it("new ids are 12 characters from the same alphabet, drawn with crypto.randomInt", () => {
    const spy = vi.spyOn(crypto, "randomInt");
    const id = generatePublicId();
    expect(id).toHaveLength(12);
    for (const ch of id) expect(PUBLIC_ID_ALPHABET).toContain(ch);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(new Set(Array.from({ length: 200 }, () => generatePublicId())).size).toBe(200);
  });

  it("an old 8-character id still resolves", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications WHERE public_id", { rows: [fullRow] }]]));
    const res = await request(makeApp()).get("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp());
    expect(res.status).toBe(200);
    expect(res.body.application.public_id).toBe("ABCDEFGH");
    expect(queryMock.mock.calls[0][1]).toEqual(["ABCDEFGH"]);
  });
});

describe("GET /applications/:publicId", () => {
  it("masks the government ID number to its last 3 characters and drops the carrier payloads", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{
      ...fullRow, q_ca_id_number: "D1234-56789-01234",
      carrier_submission_request: { secret: 1 }, carrier_submission_response: { secret: 2 }, carrier_submission_error: "boom",
    }] }]]));
    const res = await request(makeApp()).get("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp());
    expect(res.status).toBe(200);
    expect(res.body.application.q_ca_id_number).toBe("***234");
    expect(res.body.application).not.toHaveProperty("carrier_submission_request");
    expect(res.body.application).not.toHaveProperty("carrier_submission_response");
    expect(res.body.application).not.toHaveProperty("carrier_submission_error");
    expect(JSON.stringify(res.body)).not.toContain("D1234");
  });

  it("does not return a stored provider error as the score reason", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...fullRow, score_decision: "error", score_reason: "connect ECONNREFUSED 10.0.0.5:443" }] }]]));
    const res = await request(makeApp()).get("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp());
    expect(res.body.application.score_reason).toBe("score_failed");
  });
});

describe("PATCH /applications/:publicId - edit lock", () => {
  for (const status of [null, "", "created", "in_progress"]) {
    it(`status ${JSON.stringify(status)} is editable`, async () => {
      queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...fullRow, status }] }]]));
      const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ business_name: "New" });
      expect(res.status).toBe(200);
      expect(callsMatching(queryMock, /UPDATE bi_applications SET/)).toHaveLength(1);
    });
  }
  for (const status of ["document_review", "ready_for_submission", "submitted", "approved", "declined", "policy_issued"]) {
    it(`status ${status} answers 409 application_locked and writes nothing`, async () => {
      queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...fullRow, status }] }]]));
      const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ business_name: "New" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "application_locked" });
      expect(callsMatching(queryMock, /UPDATE/)).toHaveLength(0);
    });
  }
});

describe("PATCH /applications/:publicId - guarantor phone", () => {
  it("can be set while empty", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...fullRow, guarantor_phone: null }] }]]));
    const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ guarantor_phone: "+14165559999" });
    expect(res.status).toBe(200);
    const upd = callsMatching(queryMock, /UPDATE bi_applications SET/)[0];
    expect(String(upd[0])).toMatch(/guarantor_phone = \$1/);
    expect((upd[1] as unknown[])[0]).toBe("+14165559999");
  });

  it("cannot be changed once set: 409 phone_locked", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [fullRow] }]]));
    const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ guarantor_phone: "+14165550000", business_name: "X" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "phone_locked" });
    expect(callsMatching(queryMock, /UPDATE/)).toHaveLength(0);
  });

  it("sending the same number (any formatting) is fine", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [fullRow] }]]));
    const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ guarantor_phone: "(416) 555-1234" });
    expect(res.status).toBe(200);
  });

  it("an autosave echoing the masked ID number does not overwrite it", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [fullRow] }]]));
    const res = await request(makeApp()).patch("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp()).send({ q_ca_id_number: "***234", business_name: "Y" });
    expect(res.status).toBe(200);
    const upd = callsMatching(queryMock, /UPDATE bi_applications SET/)[0];
    expect(String(upd[0])).not.toMatch(/q_ca_id_number/);
  });
});

describe("rate limit: 30 per minute per IP on the public application routes", () => {
  it("the 31st request from one IP gets 429; another IP and other routes are unaffected", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [fullRow] }]]));
    const a = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const path = i % 2 ? "/applications/ABCDEFGH" : "/applications/ABCDEFGH/documents";
      statuses.push((await request(a).get(path).set("X-Forwarded-For", LIMIT_IP)).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await request(a).get("/applications/ABCDEFGH").set("X-Forwarded-For", nextIp())).status).toBe(200);
    // Not a public route of this router: never limited by it.
    expect((await request(a).get("/applications/ABCDEFGH/activity").set("X-Forwarded-For", LIMIT_IP)).status).toBe(200);
  });
});

describe("POST /applications/:publicId/documents - limits and content check", () => {
  const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const docRow = { ...fullRow, status: "in_progress" };
  const rules = () => answerBySql([
    ["SELECT id, score_decision, status, source FROM bi_applications", { rows: [docRow] }],
    ["INSERT INTO bi_documents", { rows: [{ id: "doc-1" }] }],
  ]);

  it("stores a real PDF", async () => {
    queryMock.mockImplementation(rules());
    const res = await request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp())
      .field("doc_types", "profit_loss")
      .attach("files", PDF, { filename: "pl.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("refuses content that does not match the extension (PNG bytes named .pdf) before storing anything", async () => {
    queryMock.mockImplementation(rules());
    const res = await request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp())
      .field("doc_types", "profit_loss").field("doc_types", "balance_sheet")
      .attach("files", PDF, { filename: "ok.pdf", contentType: "application/pdf" })
      .attach("files", PNG, { filename: "evil.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "content_mismatch", file_index: 1 });
    expect(putMock).not.toHaveBeenCalled();
  });

  it("refuses a declared type outside the allowlist with a code", async () => {
    queryMock.mockImplementation(rules());
    const res = await request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp())
      .field("doc_types", "profit_loss")
      .attach("files", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("mime_not_allowed");
  });

  it("more than 10 files -> 413 too_many_files", async () => {
    queryMock.mockImplementation(rules());
    let req = request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp());
    for (let i = 0; i < 11; i++) req = req.attach("files", PDF, { filename: `f${i}.pdf`, contentType: "application/pdf" });
    const res = await req;
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("too_many_files");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("a file over 25 MB -> 413 file_too_large", async () => {
    queryMock.mockImplementation(rules());
    const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0x20);
    PDF.copy(big);
    const res = await request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp())
      .field("doc_types", "profit_loss")
      .attach("files", big, { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("file_too_large");
  });

  it("an unknown doc type still answers 400 invalid_doc_type with the allowlist", async () => {
    queryMock.mockImplementation(rules());
    const res = await request(makeApp()).post("/applications/ABCDEFGH/documents").set("X-Forwarded-For", nextIp())
      .field("doc_types", "other")
      .attach("files", PDF, { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_doc_type");
    expect(res.body.allowed).toEqual(["loan_agreement", "profit_loss", "balance_sheet", "ar_aging", "ap_aging", "founder_cv", "financial_forecast"]);
  });
});

describe("POST /applications/:publicId/submit - gates unchanged", () => {
  it("Quebec is refused with its code after the derived consents are saved", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [{ ...fullRow, q_business_province: "QC" }] }]]));
    const res = await request(makeApp()).post("/applications/ABCDEFGH/submit").set("X-Forwarded-For", nextIp()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("quebec_blocked");
    expect(callsMatching(queryMock, /SET consents = \$1::jsonb/)).toHaveLength(1);
    expect(callsMatching(queryMock, /status='in_progress'/)).toHaveLength(0);
  });

  it("a passing application advances to in_progress", async () => {
    queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [fullRow] }]]));
    const res = await request(makeApp()).post("/applications/ABCDEFGH/submit").set("X-Forwarded-For", nextIp()).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "in_progress" });
  });
});

describe("POST /applications/score - provider errors stay server-side", () => {
  it("answers 502 score_failed and stores a code, not the error text", async () => {
    queryMock.mockImplementation(answerBySql([]));
    scoreMock.mockRejectedValue(new Error("PGI said: internal db host pgi-prod-7 down"));
    const res = await request(makeApp()).post("/applications/score").set("X-Forwarded-For", nextIp()).send({
      country: "CA", naics_code: "541330", formation_date: "2018-04-15", loan_amount: 500000, pgi_limit: 400000,
      annual_revenue: 2000000, ebitda: 300000, total_debt: 100000, monthly_debt_service: 4000,
      collateral_value: 800000, enterprise_value: 3000000,
    });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("score_failed");
    expect(res.body.public_id).toHaveLength(12);
    expect(JSON.stringify(res.body)).not.toContain("pgi-prod-7");
    const upd = callsMatching(queryMock, /score_decision='error'/)[0];
    expect((upd[1] as unknown[])[0]).toBe("score_failed");
  });
});
