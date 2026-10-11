// BI_SERVER_BF_PHONE_v282
// v789 [5]/[37]: the route half was a grep of biApplicationsFromBfRoutes.ts; it
// now posts a BF handoff to the real router and reads the phone it stored. The
// repair migration is a .sql file and keeps its source check.
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { normalizeE164 } from "../util/phoneE164";
import { answerBySql, callsMatching } from "../__tests__/helpers/answerBySql";
import { insertColumns } from "../__tests__/helpers/insertColumns";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biApplicationsFromBfRoutes from "../routes/biApplicationsFromBfRoutes";

async function storedPhones(guarantorPhone: string) {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [], rowCount: 0 }]]));
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", biApplicationsFromBfRoutes);
  const token = jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string);
  const r = await request(app).post("/api/v1/bi/applications/from-bf")
    .set("Authorization", `Bearer ${token}`)
    .send({ bf_application_id: "bf-282", guarantor_phone: guarantorPhone });
  expect(r.status).toBe(200);
  const [call] = callsMatching(queryMock, "INSERT INTO bi_applications");
  const row = insertColumns(String(call![0]), call![1] as unknown[]);
  return { signIn: row.applicant_phone_e164.value, guarantor: row.guarantor_phone.value };
}

describe("BF referral phone", () => {
  it("the formatted BF wizard phone becomes the E.164 number applicants sign in with", () => {
    expect(normalizeE164("(780) 916-7413")).toBe("+17809167413");
  });
  it("is normalised on intake", async () => {
    expect(await storedPhones("(780) 916-7413")).toEqual({ signIn: "+17809167413", guarantor: "+17809167413" });
    // Unparseable input is kept as given rather than dropped.
    expect((await storedPhones("call me")).signIn).toBe("call me");
  });
  it("is repaired for existing referrals", () => {
    const sql = readFileSync("src/db/migrations/2026_09_16_v282_bf_referral_phone_repair.sql", "utf-8");
    expect(sql).toContain("WHERE source = 'bf_pgi_referral'");
    expect(sql).toContain("'+1' || d.digits");
  });
});
