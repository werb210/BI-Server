// BI_SERVER_BF_CO_APPLICANT_v391
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const { queryMock, SECRET } = vi.hoisted(() => ({ queryMock: vi.fn(), SECRET: "test-shared-secret-min-10" }));
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
vi.mock("../../platform/env", () => ({ env: { JWT_SECRET: SECRET } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import router from "../biApplicationsFromBfRoutes";
import { isCompleteCoGuarantor, isoDate, normalizeBfCoGuarantors } from "../../services/bfCoGuarantors";

const app = () => { const a = express(); a.use(express.json()); a.use(router); return a; };
const token = () => jwt.sign({ kind: "service", source: "bf-server" }, SECRET);

const complete = {
  first_name: "Bo", last_name: "Lee", email: "BO@acme.com", phone: "+14035551234", date_of_birth: "1980-02-03",
  address: "1 Main St", city: "Calgary", province: "ab", postal_code: "T2P 1A1", relationship: "Co-applicant",
};

describe("co-guarantor normalising", () => {
  it("accepts ISO and MM/DD/YYYY dates", () => {
    expect(isoDate("1980-02-03")).toBe("1980-02-03");
    expect(isoDate("2/3/1980")).toBe("1980-02-03");
    expect(isoDate("sometime")).toBeNull();
  });
  it("requires every column bi_co_guarantors needs, and not Quebec", () => {
    const [g] = normalizeBfCoGuarantors([complete]);
    expect(g.province).toBe("AB");
    expect(g.email).toBe("bo@acme.com");
    expect(isCompleteCoGuarantor(g)).toBe(true);
    expect(isCompleteCoGuarantor({ ...g, date_of_birth: null })).toBe(false);
    expect(isCompleteCoGuarantor({ ...g, province: "QC" })).toBe(false);
  });
  it("drops unnamed entries", () => {
    expect(normalizeBfCoGuarantors([{ email: "x@y.com" }])).toEqual([]);
    expect(normalizeBfCoGuarantors("nope")).toEqual([]);
  });
});

describe("from-bf carries the co-applicant", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });
  it("marks the application and inserts a complete co-guarantor", async () => {
    const res = await request(app()).post("/applications/from-bf").set("Authorization", `Bearer ${token()}`)
      .send({ bf_application_id: "bf-9", guarantor_name: "Ann", co_guarantors: [complete, { first_name: "Cy" }] });
    expect(res.status).toBe(200);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    const mark = queryMock.mock.calls.find((c) => String(c[0]).includes("has_co_guarantors = TRUE"));
    expect(mark).toBeTruthy();
    expect(JSON.parse(mark![1][1])).toHaveLength(2);
    expect(sqls.filter((q) => q.includes("INSERT INTO bi_co_guarantors"))).toHaveLength(1);
  });
  it("sends nothing extra when there is no co-applicant", async () => {
    await request(app()).post("/applications/from-bf").set("Authorization", `Bearer ${token()}`)
      .send({ bf_application_id: "bf-10", guarantor_name: "Ann" });
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes("has_co_guarantors = TRUE"))).toBe(false);
  });
  it("a co-guarantor failure never fails the handoff", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO bi_co_guarantors")) throw new Error("boom");
      return { rows: [] };
    });
    const res = await request(app()).post("/applications/from-bf").set("Authorization", `Bearer ${token()}`)
      .send({ bf_application_id: "bf-11", co_guarantors: [complete] });
    expect(res.status).toBe(200);
  });
});
