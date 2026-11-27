// BI_SERVER_BANKS_IN_LENDER_FLOWS_v1 - bank-tagged contacts join the lender flows; brokers do not get them.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "../../db";
import { resetDb, seedCompany, seedContact } from "../../test-support/integrationDb";
import { addFlowAudience } from "../../services/flows/flowAudience";

describe.skipIf(!process.env.DATABASE_URL)("lender flows take banks (real DB)", () => {
  beforeEach(async () => { await resetDb(); await pool.query(`TRUNCATE bi_flow_members, bi_flows CASCADE`); });
  afterAll(async () => { await pool.query(`TRUNCATE bi_flow_members, bi_flows CASCADE`); await pool.end(); });

  it("adds lender- and bank-tagged contacts to a lender flow, and only brokers to a broker flow", async () => {
    const co = await seedCompany({});
    const tag = async (email: string, tags: string[]) => {
      const c = await seedContact(co.id, { email });
      await pool.query(`UPDATE bi_contacts SET tags = $2, country = 'CA' WHERE id = $1`, [c.id, tags]);
    };
    await tag("l@x.test", ["lender"]); await tag("b@x.test", ["bank"]); await tag("k@x.test", ["broker"]); await tag("n@x.test", ["other"]);
    const mk = async (audience: string) => (await pool.query(`INSERT INTO bi_flows (name, audience, market, status) VALUES ($1, $1, 'CA', 'draft') RETURNING id`, [audience])).rows[0].id;
    expect(await addFlowAudience(pool, await mk("lender"), "lender", "CA")).toBe(2);
    expect(await addFlowAudience(pool, await mk("broker"), "broker", "CA")).toBe(1);
  });
});
