// BI_SERVER_v856_CRM_UNIFY - the BI unified CRM against a real Postgres (the schema the migrations build). Skipped
// when DATABASE_URL is not set (unit config). Covers: the migration twice, bi_norm_tag() matching the TypeScript
// rules, the contacts list (company name + untagged), tags, company people, details, both merges and clean-up undo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "../../db";
import { requireAuth } from "../../platform/auth";
import biCrmRoutes from "../biCrmRoutes";
import biCrmUnifyRoutes from "../biCrmUnifyRoutes";
import biCompanyActivityRoutes from "../biCompanyActivityRoutes";
import { normalizeTag } from "../../services/crmUnify/tags";
// The migration text, loaded by the test runner (not read from disk by the test).
import migrationSql from "../../db/migrations/2026_10_25_v856_crm_unify.sql?raw";

const tag = randomUUID().slice(0, 8);
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1/bi", requireAuth, biCrmRoutes);
  a.use("/api/v1/bi", requireAuth, biCrmUnifyRoutes);
  a.use("/api/v1/bi", requireAuth, biCompanyActivityRoutes);
  return a;
}
const auth = () => `Bearer ${jwt.sign({ staffUserId: "staff-v856", role: "admin" }, process.env.JWT_SECRET as string)}`;
const get = (p: string) => request(app()).get(`/api/v1/bi${p}`).set("Authorization", auth());
const post = (p: string, body: object) => request(app()).post(`/api/v1/bi${p}`).set("Authorization", auth()).send(body);
const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

let company = "";
let dupCompany = "";
let keeper = "";
let dup = "";
let plain = "";

describe.skipIf(!process.env.DATABASE_URL)("v856 BI unified CRM (real DB)", () => {
  beforeAll(async () => {
    company = (await one(`INSERT INTO bi_companies (legal_name, website) VALUES ($1, $2) RETURNING id`, [`Voss Events ${tag} Inc`, `vossevents-${tag}.com`])).id;
    dupCompany = (await one(`INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`, [`VOSS EVENTS ${tag.toUpperCase()}`])).id;
    keeper = (await one(`INSERT INTO bi_contacts (full_name, email, phone_e164, tags) VALUES ('brandon voss', $1, '+19173043342', ARRAY['Contact form','Lender']) RETURNING id`, [`bv-${tag}@vossevents.com`])).id;
    dup = (await one(`INSERT INTO bi_contacts (full_name, phone_e164, company_id, tags) VALUES ('Brandon Voss', '917-304-3342', $1, ARRAY['active']) RETURNING id`, [company])).id;
    plain = (await one(`INSERT INTO bi_contacts (full_name, email, organization_name, tags) VALUES ('TODD WERB', $1, $2, ARRAY['applicant_otp']) RETURNING id`, [`todd-${tag}@example.com`, `Org ${tag}`])).id;
    await pool.query(
      `INSERT INTO bi_applications (created_by_actor, primary_contact_id, company_id, guarantor_name, guarantor_email, directors)
       VALUES ('staff', $1, $2, 'Gail Guarantor', $3, $4::jsonb)`,
      [keeper, company, `gail-${tag}@x.co`, JSON.stringify([{ name: "Dan Director", email: `dan-${tag}@x.co` }])],
    );
    await pool.query(migrationSql);
    await pool.query(migrationSql);
  });

  afterAll(async () => {
    const ids = [keeper, dup, plain].filter(Boolean);
    await pool.query(`DELETE FROM bi_applications WHERE primary_contact_id = ANY($1::uuid[]) OR company_id = ANY($2::uuid[])`, [ids, [company, dupCompany]]);
    await pool.query(`DELETE FROM bi_contacts WHERE id = ANY($1::uuid[]) OR email ILIKE $2`, [ids, `%${tag}%`]);
    await pool.query(`DELETE FROM bi_companies WHERE id = ANY($1::uuid[])`, [[company, dupCompany]]);
    await pool.query(`DELETE FROM bi_crm_tag_definitions WHERE slug LIKE $1`, [`%${tag}%`]);
  });

  it("bi_norm_tag() matches normalizeTag() and the migration normalised stored tags and linked the applicant", async () => {
    const samples = ["Contact form", " LENDER ", "Account/Book Keeper", "booked-call", "Re--ferrer!!", "",
      "Lawyer/advisor", "Insurance/advisor", "A/R Credit Insurance/advisor"];
    const r = await pool.query(`SELECT bi_norm_tag(x) AS n FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY i`, [samples]);
    expect(r.rows.map((x: any) => x.n)).toEqual(samples.map(normalizeTag));
    const k = await one(`SELECT tags, company_id FROM bi_contacts WHERE id = $1`, [keeper]);
    expect(k.tags).toEqual(["contact_form", "lender"]);
    expect(k.company_id).toBe(company);
  });

  it("the contacts list fills the company name and filters untagged (system tags alone count)", async () => {
    const r = await get(`/crm/contacts?q=${tag}`);
    const row = r.body.data.find((x: any) => x.id === plain);
    expect(row.company_name).toBe(`Org ${tag}`);
    const untagged = await get(`/crm/contacts?q=${tag}&tags=__none__`);
    expect(untagged.body.data.map((x: any) => x.id)).toEqual([plain]);
  });

  it("tags, company people, details", async () => {
    expect((await post("/crm/unified/tags/apply", { entity: "company", ids: [company], add: ["Lender"] })).body.updated).toBe(1);
    expect((await post("/crm/unified/tags/definitions", { label: `Carrier ${tag}` })).status).toBe(201);
    const people = await get(`/crm/unified/companies/${company}/people`);
    const g = people.body.data.groups;
    expect(g.primary.map((p: any) => p.contactId)).toEqual([keeper]);
    expect(g.partners.map((p: any) => p.name)).toEqual(["Dan Director"]);
    expect(g.guarantors.map((p: any) => p.name)).toEqual(["Gail Guarantor"]);
    expect((await post(`/crm/unified/companies/${company}/people`, { contactId: plain, role: "lawyer" })).status).toBe(201);
    const after = await get(`/crm/unified/companies/${company}/people`);
    expect(after.body.data.groups.advisors.map((p: any) => p.contactId)).toEqual([plain]);
    expect((await post(`/crm/unified/companies/${company}/people/remove`, { contactId: plain })).status).toBe(200);
    expect((await one(`SELECT count(*)::int AS n FROM bi_crm_audit WHERE entity_id = $1`, [company])).n).toBe(2);
    const saved = await request(app()).patch(`/api/v1/bi/crm/unified/companies/${company}/details`).set("Authorization", auth()).send({ country: "CA", employees: "12" });
    expect(saved.status).toBe(200);
    expect(await one(`SELECT country, employees FROM bi_companies WHERE id = $1`, [company])).toEqual({ country: "CA", employees: 12 });
  });

  it("merges contacts and companies and cleans up with undo", async () => {
    const d = await get(`/crm/unified/duplicates/contact/${keeper}`);
    expect(d.body.data.candidates.map((x: any) => x.id)).toEqual([dup]);
    const m = await post("/crm/unified/merge/contact", { survivorId: keeper, loserIds: [dup], fields: { full_name: "Brandon Voss" } });
    expect(m.status).toBe(200);
    expect(await one(`SELECT full_name FROM bi_contacts WHERE id = $1`, [keeper])).toEqual({ full_name: "Brandon Voss" });
    expect((await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1`, [dup])).rowCount).toBe(0);
    const cd = await get(`/crm/unified/duplicates/company/${company}`);
    expect(cd.body.data.candidates.map((x: any) => x.id)).toEqual([dupCompany]);
    expect((await post("/crm/unified/merge/company", { survivorId: company, loserIds: [dupCompany] })).status).toBe(200);
    expect((await pool.query(`SELECT 1 FROM bi_companies WHERE id = $1`, [dupCompany])).rowCount).toBe(0);

    const scan = await get("/crm/unified/cleanup/scan?entity=contact");
    const mine = scan.body.data.changes.filter((c: any) => c.entityId === plain);
    expect(mine).toEqual([expect.objectContaining({ field: "full_name", after: "Todd Werb" })]);
    const applied = await post("/crm/unified/cleanup/apply", { changes: mine });
    expect(applied.body.data.applied).toBe(1);
    expect((await post(`/crm/unified/cleanup/batches/${applied.body.data.batchId}/undo`, {})).body.data.restored).toBe(1);
    expect(await one(`SELECT full_name FROM bi_contacts WHERE id = $1`, [plain])).toEqual({ full_name: "TODD WERB" });
  });
});

// BI_SERVER_v856_CRM_UNIFY - Todd's second round, in BI: people from applications become contacts, the applicant is the
// Primary applicant, the contact panel, company activity from its people, and the duplicate rules + placeholder merge.
describe.skipIf(!process.env.DATABASE_URL)("v856 BI people, panel, activity and duplicates (real DB)", () => {
  const t2 = randomUUID().slice(0, 8);
  let voss = "";
  let brandon = "";
  let todd1 = "";
  let todd2 = "";
  let bigA = "";
  let bigB = "";
  let real = "";
  let ph = "";
  let appId = "";

  beforeAll(async () => {
    voss = (await one(`INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`, [`Voss Events ${t2}, Inc.`])).id;
    bigA = (await one(`INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`, [`${t2} Big Brokerage`])).id;
    bigB = (await one(`INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`, [`${t2} Big Broker`])).id;
    brandon = (await one(`INSERT INTO bi_contacts (full_name, email, company_id) VALUES ($1, $2, $3) RETURNING id`, [`Brandon Voss ${t2}`, `brandon-${t2}@example.com`, voss])).id;
    todd1 = (await one(`INSERT INTO bi_contacts (full_name, email) VALUES ($1, $2) RETURNING id`, [`Todd Werboweski ${t2}`, `todd1-${t2}@example.com`])).id;
    todd2 = (await one(`INSERT INTO bi_contacts (full_name, email) VALUES ($1, $2) RETURNING id`, [`todd  werboweski ${t2}`, `todd2-${t2}@example.com`])).id;
    real = (await one(`INSERT INTO bi_contacts (full_name, email, phone_e164) VALUES ($1, $2, '+17805550199') RETURNING id`, [`Rae Real ${t2}`, `rae-${t2}@example.com`])).id;
    ph = (await one(`INSERT INTO bi_contacts (full_name, phone_e164) VALUES ('Unknown (application started)', '780-555-0199') RETURNING id`)).id;
    // Filed with no company: the applicant's own record points at Voss Events.
    appId = (await one(
      `INSERT INTO bi_applications (created_by_actor, primary_contact_id, company_id, business_name, coverage_amount, guarantor_name, guarantor_email, directors)
       VALUES ('staff', $1, NULL, $2, 150000, $3, $4, $5::jsonb) RETURNING id`,
      [brandon, `Voss Events ${t2}`, `Gus Guarantor${t2}`, `gus-${t2}@x.co`, JSON.stringify([{ name: `Dana Director${t2}`, email: `dana-${t2}@x.co`, title: "Director" }])],
    )).id;
    await pool.query(`INSERT INTO bi_contact_activity (contact_id, actor_name, event_type, body) VALUES ($1, 'Todd', 'note', $2)`, [brandon, `Called Brandon ${t2}`]);
    await pool.query(migrationSql);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM bi_applications WHERE id = $1`, [appId]);
    await pool.query(`DELETE FROM bi_contact_activity WHERE contact_id = $1`, [brandon]);
    await pool.query(`DELETE FROM bi_contacts WHERE id = ANY($1::uuid[]) OR email ILIKE $2 OR full_name ILIKE $2`, [[brandon, todd1, todd2, real, ph].filter(Boolean), `%${t2}%`]);
    await pool.query(`DELETE FROM bi_companies WHERE id = ANY($1::uuid[])`, [[voss, bigA, bigB].filter(Boolean)]);
  });

  it("the applicant is Primary applicant; director and guarantor become tagged contacts on the company", async () => {
    const r = await get(`/crm/unified/companies/${voss}/people`);
    const g = r.body.data.groups;
    expect(g.primary.map((p: any) => p.contactId)).toEqual([brandon]);
    expect(g.partners).toEqual([expect.objectContaining({ email: `dana-${t2}@x.co`, detail: "Director", contactId: expect.any(String) })]);
    expect(g.guarantors).toEqual([expect.objectContaining({ email: `gus-${t2}@x.co`, contactId: expect.any(String) })]);
    expect(g.other).toEqual([]);
    expect((await one(`SELECT tags FROM bi_contacts WHERE email = $1`, [`dana-${t2}@x.co`])).tags).toEqual(["partner"]);
    expect((await one(`SELECT tags FROM bi_contacts WHERE email = $1`, [`gus-${t2}@x.co`])).tags).toEqual(["guarantor"]);
    await get(`/crm/unified/companies/${voss}/people`); // a second read adds nothing
    expect((await one(`SELECT count(*)::int AS n FROM bi_contacts WHERE email = $1`, [`dana-${t2}@x.co`])).n).toBe(1);
  });

  it("contact panel lists the application with its people and a pipeline link", async () => {
    const r = await get(`/crm/unified/contacts/${brandon}/applications`);
    expect(r.body.data.applications).toEqual([expect.objectContaining({
      id: appId, business: `Voss Events ${t2}`, amount: 150000, submitted: true, link: `/silo/bi/pipeline/${appId}`,
      partners: expect.arrayContaining([expect.objectContaining({ role: "partner" }), expect.objectContaining({ role: "guarantor" })]),
    })]);
  });

  it("company activity includes its people's activity", async () => {
    const r = await get(`/crm/companies/${voss}/activity`);
    expect(r.body.events.some((e: any) => e.body === `Called Brandon ${t2}` && e.contact_name === `Brandon Voss ${t2}`)).toBe(true);
  });

  it("duplicates: the same full name anywhere, a shortened company name, and placeholders merged into the real record", async () => {
    const d = await get(`/crm/unified/duplicates/contact/${todd1}`);
    expect(d.body.data.candidates).toEqual([expect.objectContaining({ id: todd2, reasons: ["Same name"] })]);
    const m = await post("/crm/unified/merge/contact", { survivorId: todd1, loserIds: [todd2] });
    expect(m.status).toBe(200);
    expect((await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1`, [todd2])).rowCount).toBe(0);
    const c = await get(`/crm/unified/duplicates/company/${bigA}`);
    expect(c.body.data.candidates).toEqual([expect.objectContaining({ id: bigB, reasons: ["Similar name"] })]);
    const plan = await post("/crm/unified/duplicates/merge-placeholders", { dryRun: true });
    expect(plan.body.data.plan).toContainEqual(expect.objectContaining({ survivorId: real, loserIds: [ph] }));
    const done = await post("/crm/unified/duplicates/merge-placeholders", {});
    expect(done.body.data.merged).toBeGreaterThanOrEqual(1);
    expect((await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1`, [ph])).rowCount).toBe(0);
  });
});
