// BI_SERVER_LIST_IMPORT_v1 - a prospect list (companies and their people) imported twice. Real database.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../platform/auth", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { role: "admin" }; next(); } }));

import router, { listPhone, listTags, listCustom } from "../../routes/biListImportRoutes";

describe("list import helpers", () => {
  it("reads phone numbers with an extension, lower-cases tags and keeps only well-named research fields", () => {
    expect(listPhone("(905) 660-1898 ext. 225")).toEqual({ number: "+19056601898", extension: "225" });
    expect(listPhone("1-305-441-8443")).toEqual({ number: "+13054418443", extension: null });
    expect(listPhone("12345")).toBeNull();
    expect(listTags(["Priority A", "priority a", " US lender list "])).toEqual(["priority a", "us lender list"]);
    expect(listTags("lender; Priority B")).toEqual(["lender", "priority b"]);
    expect(listCustom({ import_source: " List ", "Bad Key": "x", n: 212, empty: "" })).toEqual({ import_source: "List", n: 212 });
  });
});

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("importing a prospect list", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", router);
  const tag = "li" + Math.floor(Math.random() * 1e9);
  const bank = `Sample Bank ${tag}`;
  const pat = `Pat ${tag}`;

  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(async () => {
    await pool.query(`DELETE FROM bi_contact_activity WHERE contact_id IN (SELECT id FROM bi_contacts WHERE organization_name = $1)`, [bank]);
    await pool.query(`DELETE FROM bi_contacts WHERE organization_name = $1`, [bank]);
    await pool.query(`DELETE FROM bi_companies WHERE legal_name = $1`, [bank]);
    await pool.end();
  });

  it("creates the company and its people, then a richer second import updates the same records", async () => {
    const first = await request(app).post("/api/v1/bi/crm/list-import").send({
      source: "Test list",
      companies: [{ name: bank, kind: "lender", website: "https://bank.test", address_state: "TX", address_country: "United States", employee_count: "140", tags: "lender; Priority A", custom_fields: { sba_7a_loans_12m: "212" } }],
      contacts: [
        { name: pat, company_name: bank, job_title: "SVP SBA Lending", phone: "(555) 010-0101 ext. 22", mobile: "(555) 010-0102", tags: ["lender", "Do not call: mobile"], custom_fields: { import_source: "List A" } },
        { name: `Sam ${tag}`, company_name: bank, email: `sam.${tag}@bank.test`, tags: ["lender"] },
        { company_name: bank },
      ],
    });
    expect(first.body).toMatchObject({ ok: true, companies_created: 1, contacts_created: 2, contacts_updated: 0, skipped: 1 });

    const second = await request(app).post("/api/v1/bi/crm/list-import").send({
      source: "Test list 2",
      companies: [{ name: bank.toUpperCase(), tags: "Second" }],
      contacts: [{ name: pat, company_name: bank, email: `pat.${tag}@bank.test`, tags: ["Enriched"] }],
    });
    expect(second.body).toMatchObject({ companies_created: 0, companies_updated: 1, contacts_created: 0, contacts_updated: 1 });

    const co = (await pool.query(`SELECT * FROM bi_companies WHERE legal_name = $1`, [bank])).rows;
    expect(co).toHaveLength(1);
    expect(co[0]).toMatchObject({ kind: "lender", website: "https://bank.test", province: "TX", country: "US", employees: 140 });
    expect([...co[0].tags].sort()).toEqual(["lender", "priority a", "second"]);
    expect(co[0].custom_fields).toMatchObject({ sba_7a_loans_12m: "212" });

    const people = (await pool.query(`SELECT * FROM bi_contacts WHERE organization_name = $1 ORDER BY full_name`, [bank])).rows;
    expect(people).toHaveLength(2);
    const p = people.find((x) => x.full_name === pat);
    expect(p).toMatchObject({ email: `pat.${tag}@bank.test`, phone_e164: "+15550100101", company_id: co[0].id, title: "SVP SBA Lending", outreach_status: "cold", notes: "Extension 22" });
    expect([...p.tags].sort()).toEqual(["do not call: mobile", "enriched", "lender"]);
    expect(p.custom_fields).toMatchObject({ import_source: "List A" });
    expect(p.phone_numbers).toEqual([{ type: "work", number: "+15550100101", extension: "22" }, { type: "mobile", number: "+15550100102" }]);
    expect(p.marketing_consent_basis ?? null).toBeNull();
    const acts = await pool.query(`SELECT event_type FROM bi_contact_activity WHERE contact_id = $1`, [p.id]);
    expect(acts.rows.map((a) => a.event_type)).toEqual(["import", "import"]);
  });

  it("refuses an empty request", async () => {
    const r = await request(app).post("/api/v1/bi/crm/list-import").send({});
    expect(r.status).toBe(400);
  });
});
