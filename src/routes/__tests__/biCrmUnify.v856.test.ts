// BI_SERVER_v856_CRM_UNIFY - /api/v1/bi/crm/unified/* behind requireAuth, database faked by SQL content.
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching, type SqlRule } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ query: vi.fn(), model: vi.fn(), contactSummary: vi.fn() }));
vi.mock("../../db", () => ({
  pool: { query: (...a: unknown[]) => h.query(...a), connect: async () => ({ query: (...a: unknown[]) => h.query(...a), release: () => undefined }) },
}));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("../biContactAnalyticsRoutes", () => ({
  biSummaryModel: (p: string) => h.model(p),
  summaryForContact: (id: string) => h.contactSummary(id),
}));

import { requireAuth } from "../../platform/auth";
import biCrmUnifyRoutes from "../biCrmUnifyRoutes";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const CO = "33333333-3333-4333-8333-333333333333";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", requireAuth, biCrmUnifyRoutes);
  return a;
}
const staff = (role = "staff") => `Bearer ${jwt.sign({ staffUserId: "staff-1", role }, process.env.JWT_SECRET as string)}`;
const db = (rules: SqlRule[]) => h.query.mockImplementation(answerBySql(rules, { rows: [], rowCount: 0 }));

beforeEach(() => {
  h.query.mockReset();
  h.model.mockReset();
  h.contactSummary.mockReset();
  db([]);
});

describe("v856 BI unified CRM", () => {
  it("service tokens are refused; staff get the tag catalogue", async () => {
    const svc = `Bearer ${jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string)}`;
    expect((await request(app()).get("/api/v1/bi/crm/unified/tags").set("Authorization", svc)).status).toBe(403);
    db([[/FROM bi_crm_tag_definitions/, { rows: [] }], [/FROM bi_contacts c, unnest/, { rows: [{ tag: "bookkeeper", contacts: 2, companies: 0 }, { tag: "applicant_otp", contacts: 5, companies: 0 }] }]]);
    const r = await request(app()).get("/api/v1/bi/crm/unified/tags").set("Authorization", staff());
    expect(r.status).toBe(200);
    expect(r.body.data.inUse).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: "accountant", label: "Accountant/Bookkeeper", kind: "core", contacts: 2 }),
      expect.objectContaining({ tag: "applicant_otp", kind: "system" }),
    ]));
  });

  it("applies and removes staff tags in bulk and refuses system tags", async () => {
    db([[/UPDATE bi_contacts\s+SET tags = bi_norm_tags/, { rows: [], rowCount: 2 }]]);
    const r = await request(app()).post("/api/v1/bi/crm/unified/tags/apply").set("Authorization", staff()).send({ entity: "contact", ids: [C1, C2], add: ["Lawyer"], remove: ["Active"] });
    expect(r.body).toMatchObject({ ok: true, updated: 2, added: ["lawyer"], removed: ["active"] });
    expect(callsMatching(h.query, /UPDATE bi_contacts/)[0]![1]).toEqual([[C1, C2], ["lawyer"], ["active"]]);
    const sys = await request(app()).post("/api/v1/bi/crm/unified/tags/apply").set("Authorization", staff()).send({ entity: "contact", ids: [C1], remove: ["applicant_otp"] });
    expect(sys.status).toBe(400);
  });

  it("only an Admin edits the BI tag list", async () => {
    expect((await request(app()).post("/api/v1/bi/crm/unified/tags/definitions").set("Authorization", staff()).send({ label: "Carrier" })).status).toBe(403);
    expect((await request(app()).post("/api/v1/bi/crm/unified/tags/definitions").set("Authorization", staff("admin")).send({ label: "Carrier" })).status).toBe(201);
    expect(callsMatching(h.query, /INSERT INTO bi_crm_tag_definitions/)[0]![1]).toEqual(["carrier", "Carrier", "staff-1"]);
  });

  it("company people: applicant, directors as partners, the guarantor, and hand-added people; add/remove audited", async () => {
    db([
      [/SELECT 1 FROM bi_companies/, { rows: [{}], rowCount: 1 }],
      [/FROM bi_applications a\s+WHERE a\.company_id/, { rows: [{ id: "a1", contact_id: C1, guarantor_name: "Gail Guarantor", guarantor_email: "gail@x.co", directors: [{ name: "Dan Director", email: "dan@x.co" }] }] }],
      [/FROM bi_contacts c\s+WHERE c\.converted_to_company_id IS NULL/, { rows: [{ id: C1, full_name: "Brandon Voss", email: "brandonvoss@vossevents.com", phone_e164: "+19173043342" }, { id: C2, full_name: "Larry Law", assoc_role: "lawyer" }] }],
    ]);
    const r = await request(app()).get(`/api/v1/bi/crm/unified/companies/${CO}/people`).set("Authorization", staff());
    const g = r.body.data.groups;
    expect(g.primary.map((p: any) => p.name)).toEqual(["Brandon Voss"]);
    expect(g.partners.map((p: any) => p.name)).toEqual(["Dan Director"]);
    expect(g.guarantors.map((p: any) => p.name)).toEqual(["Gail Guarantor"]);
    expect(g.advisors.map((p: any) => p.name)).toEqual(["Larry Law"]);

    db([[/SELECT id, legal_name FROM bi_companies/, { rows: [{ id: CO, legal_name: "Voss Events" }] }], [/SELECT id FROM bi_contacts/, { rows: [{ id: C2 }], rowCount: 1 }], [/SELECT 1 FROM bi_companies/, { rows: [{}], rowCount: 1 }]]);
    expect((await request(app()).post(`/api/v1/bi/crm/unified/companies/${CO}/people`).set("Authorization", staff()).send({ contactId: C2, role: "accountant" })).status).toBe(201);
    expect((await request(app()).post(`/api/v1/bi/crm/unified/companies/${CO}/people/remove`).set("Authorization", staff()).send({ contactId: C2 })).status).toBe(200);
    expect(callsMatching(h.query, /INSERT INTO bi_crm_audit/).map((c) => (c[1] as unknown[])[0])).toEqual(["crm.company_person_added", "crm.company_person_removed"]);
    expect(callsMatching(h.query, /UPDATE bi_contacts SET company_id = NULL/)).toHaveLength(1);
  });

  it("contact merge runs the BI merge for each duplicate and keeps the chosen values", async () => {
    db([[/SELECT \* FROM bi_contacts WHERE id = ANY/, { rows: [{ id: C1, full_name: "brandon voss", email: null }, { id: C2, full_name: "Brandon Voss", email: "b@voss.co" }] }]]);
    const r = await request(app()).post("/api/v1/bi/crm/unified/merge/contact").set("Authorization", staff())
      .send({ survivorId: C1, loserIds: [C2], fields: { full_name: "Brandon Voss", email: "b@voss.co" } });
    expect(r.status).toBe(200);
    expect(callsMatching(h.query, /DELETE FROM bi_contacts WHERE id = \$1/)[0]![1]).toEqual([C2]);
    const upd = callsMatching(h.query, /UPDATE bi_contacts SET "full_name"/)[0]!;
    expect(upd[1]).toEqual([C1, "Brandon Voss", "b@voss.co"]);
    expect(callsMatching(h.query, /COMMIT/)).toHaveLength(1);
  });

  it("clean-up applies only valid BI fields and records before-images", async () => {
    db([[/INSERT INTO bi_crm_cleanup_batches/, { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] }], [/UPDATE bi_contacts SET "full_name"/, { rows: [{ id: C1 }], rowCount: 1 }]]);
    const r = await request(app()).post("/api/v1/bi/crm/unified/cleanup/apply").set("Authorization", staff()).send({ changes: [
      { entity: "contact", entityId: C1, field: "full_name", before: "TODD WERB", after: "Todd Werb", reason: "All capitals" },
      { entity: "contact", entityId: C1, field: "tags", before: "", after: "x" },
    ] });
    expect(r.body.data).toMatchObject({ applied: 1 });
    expect(callsMatching(h.query, /INSERT INTO bi_crm_cleanup_changes/)[0]![1]).toEqual(["44444444-4444-4444-8444-444444444444", "contact", C1, "full_name", "TODD WERB", "Todd Werb", "All capitals"]);
  });

  it("AI summary for a company uses the model, skips free email domains and caches the sources", async () => {
    h.model.mockResolvedValue("Voss Events is a client. Next: call.");
    db([[/FROM bi_companies co WHERE co\.id/, { rows: [{ legal_name: "Voss Events", email: "voss@gmail.com", contact_emails: ["a@hotmail.com"], applications: 1 }] }]]);
    const r = await request(app()).post(`/api/v1/bi/crm/unified/ai-summary/company/${CO}`).set("Authorization", staff());
    expect(r.status).toBe(200);
    expect(r.body.data.summary).toContain("Voss Events");
    expect(r.body.data.sources[0]).toMatchObject({ type: "website", status: "skipped" });
    expect(callsMatching(h.query, /INSERT INTO bi_crm_ai_summaries/)).toHaveLength(1);
  });
});
