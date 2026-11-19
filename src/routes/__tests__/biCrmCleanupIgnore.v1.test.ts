// BI_SERVER_CLEANUP_IGNORE_v1 + CRM_CLEANUP_INITIALS_v1
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching, type SqlRule } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db", () => ({
  pool: { query: (...a: unknown[]) => h.query(...a), connect: async () => ({ query: (...a: unknown[]) => h.query(...a), release: () => undefined }) },
}));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("../biContactAnalyticsRoutes", () => ({ biSummaryModel: vi.fn(), summaryForContact: vi.fn() }));

import { requireAuth } from "../../platform/auth";
import biCrmUnifyRoutes from "../biCrmUnifyRoutes";
import { properCasePersonName } from "../../services/crmUnify/textClean";

const C1 = "11111111-1111-4111-8111-111111111111";
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", requireAuth, biCrmUnifyRoutes);
  return a;
}
const staff = () => `Bearer ${jwt.sign({ staffUserId: "staff-1", role: "staff" }, process.env.JWT_SECRET as string)}`;
const db = (rules: SqlRule[]) => h.query.mockImplementation(answerBySql(rules, { rows: [], rowCount: 0 }));

beforeEach(() => { h.query.mockReset(); db([]); });

describe("BI clean-up ignore", () => {
  it("ignores a proposal and stops proposing it", async () => {
    db([[/INSERT INTO bi_crm_cleanup_ignores/, { rows: [], rowCount: 1 }]]);
    const r = await request(app()).post("/api/v1/bi/crm/unified/cleanup/ignore").set("Authorization", staff()).send({ changes: [
      { entity: "contact", entityId: C1, record: "test", field: "full_name", before: "test", after: "Test", reason: "All lower case" },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.data.ignored).toBe(1);

    db([
      [/FROM bi_crm_cleanup_ignores/, { rows: [{ id: C1, field: "full_name", after_value: "Test" }] }],
      [/FROM bi_contacts c/, { rows: [{ id: C1, full_name: "test", first_name: null, last_name: null, email: null, phone_e164: null, title: null }] }],
    ]);
    const scan = await request(app()).get("/api/v1/bi/crm/unified/cleanup/scan?entity=contact").set("Authorization", staff());
    expect(scan.status).toBe(200);
    expect(scan.body.data.changes).toEqual([]);
  });

  it("clears the ignores", async () => {
    db([[/DELETE FROM bi_crm_cleanup_ignores/, { rows: [], rowCount: 3 }]]);
    const r = await request(app()).post("/api/v1/bi/crm/unified/cleanup/ignore/clear").set("Authorization", staff()).send({ entity: "contact" });
    expect(r.status).toBe(200);
    expect(r.body.data.cleared).toBe(3);
    expect(callsMatching(h.query, /DELETE FROM bi_crm_cleanup_ignores/)[0]![1]).toEqual(["contact"]);
  });
});

describe("initials keep their capitals", () => {
  it("R.J. and JP are not lower-cased", () => {
    expect(properCasePersonName("R.J.")).toBe("R.J.");
    expect(properCasePersonName("JP")).toBe("JP");
    expect(properCasePersonName("JOHN SMITH")).toBe("John Smith");
  });
});
