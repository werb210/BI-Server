// BI_SERVER_CRM_MARKETING_COLUMN_v1 - the Insurance contact list carries Marketing and sorts by Tags and Marketing. Real database.
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../platform/auth", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { role: "admin" }; next(); } }));
import router from "../../routes/biCrmRoutes";

const haveDb = !!process.env.DATABASE_URL;
(haveDb ? describe : describe.skip)("Insurance contact list columns", () => {
  let pool: Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi", router);
  const tag = "mk" + Math.floor(Math.random() * 1e9);
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const add = (n: string, tags: string[]) => pool.query(`INSERT INTO bi_contacts (full_name, email, tags) VALUES ($1,$2,$3)`, [`${n} ${tag}`, `${n.toLowerCase()}.${tag}@example.com`, [...tags, tag]]);
    await add("One", ["zebra"]);
    await add("Two", ["apple"]);
    await pool.query(`INSERT INTO bi_suppressions (identifier, email, channel, reason) VALUES ($1,$1,'email','unsubscribe')`, [`two.${tag}@example.com`]);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM bi_suppressions WHERE email LIKE $1`, [`%.${tag}@example.com`]);
    await pool.query(`DELETE FROM bi_contacts WHERE $1 = ANY(tags)`, [tag]);
    await pool.end();
  });
  it("shows Marketing Yes/No and sorts by it and by Tags", async () => {
    const get = (sort: string) => request(app).get(`/api/v1/bi/crm/contacts?sort=${sort}&q=${tag}`);
    const rows = (r: any) => (r.body.contacts ?? r.body.data ?? r.body.items ?? r.body).filter((c: any) => String(c.full_name).includes(tag));
    const byTags = rows(await get("tags:asc"));
    expect(byTags.map((c: any) => c.full_name)).toEqual([`Two ${tag}`, `One ${tag}`]);
    expect(byTags.find((c: any) => c.full_name.startsWith("Two")).marketing_contact).toBe(false);
    expect(byTags.find((c: any) => c.full_name.startsWith("One")).marketing_contact).toBe(true);
    expect(rows(await get("marketing_contact:asc"))[0].full_name).toBe(`Two ${tag}`);
  });
});
