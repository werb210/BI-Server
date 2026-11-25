// BI_SERVER_FLOW_SECOND_ADDRESS_v1 - four weeks with no opens: the flow starts again on the contact's second address.
import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../lib/pgiMarketingHold", () => ({ pgiMarketingHeld: () => false }));
import { endsFirstRoundUnopened, secondAddressStartAt } from "../../services/flows/flowEngine";
import { startSecondRound } from "../flowWorker";

const FLOW = "11111111-2222-3333-4444-555555555555";

describe("second address", () => {
  it("only after the last never-opened email of the first round", () => {
    expect(endsFirstRoundUnopened("n4", "none", 1)).toBe(true);
    expect(endsFirstRoundUnopened("n4", "none", 2)).toBe(false);
    expect(endsFirstRoundUnopened("o2", "opened", 1)).toBe(false);
    expect(endsFirstRoundUnopened("n3", "none", 1)).toBe(false);
  });

  it("restarts at e1 on the second address, a week later", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const db = { query: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push([sql, params]); return { rows: [], rowCount: 0 }; }) };
    const now = new Date("2026-11-24T17:00:00Z");
    expect(await startSecondRound(db as any, { id: "m1", flow_id: FLOW, contact_id: "c1", flow_name: "Lenders", secondary_email: " Ann.Lee@Other.com " }, "ann@bank.com", now)).toBe(true);
    const upd = calls.find(([s]) => s.includes("round = 2"))!;
    expect(upd[1][1]).toBe("ann.lee@other.com");
    expect((upd[1][2] as Date).getTime() - now.getTime()).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(secondAddressStartAt(now).getTime()).toBe((upd[1][2] as Date).getTime());
  });

  it("does nothing when the second address is missing, the same, or already in the flow", async () => {
    const empty = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    expect(await startSecondRound(empty as any, { id: "m1", flow_id: FLOW, contact_id: "c1", secondary_email: null }, "a@b.com", new Date())).toBe(false);
    expect(await startSecondRound(empty as any, { id: "m1", flow_id: FLOW, contact_id: "c1", secondary_email: "A@B.com" }, "a@b.com", new Date())).toBe(false);
    const taken = { query: vi.fn(async (sql: string) => (sql.includes("lower(email) = $2") ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 })) };
    expect(await startSecondRound(taken as any, { id: "m1", flow_id: FLOW, contact_id: "c1", secondary_email: "x@y.com" }, "a@b.com", new Date())).toBe(false);
  });
});
