// BI_SERVER_BF_REFERRAL_FIELDS_v361
// v789 [5]/[37]: the route half was a grep of biApplicationsFromBfRoutes.ts; it
// now posts a BF handoff to the real router and reads the INSERT it sent. The
// migration half reads a .sql file and stays as it was.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching } from "./helpers/answerBySql";
import { insertColumns } from "./helpers/insertColumns";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
}));

import biApplicationsFromBfRoutes from "../routes/biApplicationsFromBfRoutes";

const sql = fs.readFileSync("src/db/migrations/2026_09_18_bf_referral_fields_v361.sql", "utf8");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", biApplicationsFromBfRoutes);
  return a;
}
const bfToken = () => jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string);

async function handoff(body: Record<string, unknown>) {
  const r = await request(app())
    .post("/api/v1/bi/applications/from-bf")
    .set("Authorization", `Bearer ${bfToken()}`)
    .send({ bf_application_id: "bf-app-361", ...body });
  expect(r.status).toBe(200);
  const [call] = callsMatching(queryMock, "INSERT INTO bi_applications");
  expect(call).toBeDefined();
  return insertColumns(String(call![0]), call![1] as unknown[]);
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([["FROM bi_applications", { rows: [], rowCount: 0 }]]));
});

describe("BF referrals land with the fields the completion form pre-fills", () => {
  it("inserts country, website, business number and guarantor phone as columns", async () => {
    const row = await handoff({
      country: "us",
      business_website: "https://acme.example",
      business_number: "BN-123456",
      guarantor_phone: "(780) 916-7413",
    });
    expect(row.country.value).toBe("US");
    expect(row.business_website.value).toBe("https://acme.example");
    expect(row.business_number.value).toBe("BN-123456");
    expect(row.guarantor_phone.value).toBe("+17809167413");
    expect(row.source.expr).toBe("'bf_pgi_referral'");
  });

  it("only accepts CA or US for country (anything else stores the CA default)", async () => {
    const row = await handoff({ country: "MX" });
    expect(row.country.value).toBeNull();
    expect(row.country.expr).toMatch(/COALESCE\(\$\d+::text, 'CA'\)/);
    queryMock.mockClear();
    expect((await handoff({ country: "CA" })).country.value).toBe("CA");
  });

  it("repairs existing BF referrals idempotently", () => {
    expect(sql).toContain("SET business_number = data->>'business_number'");
    expect(sql).toContain("SET guarantor_phone = applicant_phone_e164");
    expect(sql.match(/source = 'bf_pgi_referral'/g)?.length).toBe(2);
  });
});
