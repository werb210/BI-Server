// BI_SERVER_PGI_MARKETING_HOLD_v1 - PGI marketing is held unless PGI_MARKETING_HOLD=off.
import { afterEach, describe, expect, it } from "vitest";
import { pgiMarketingHeld } from "../pgiMarketingHold";
import { runFlowTick } from "../../workers/flowWorker";
import { runFollowUpSmsTick } from "../../services/fieldReps";

const prev = process.env.PGI_MARKETING_HOLD;
afterEach(() => { process.env.PGI_MARKETING_HOLD = prev; });

describe("PGI marketing hold", () => {
  it("is on unless switched off", () => {
    delete process.env.PGI_MARKETING_HOLD;
    expect(pgiMarketingHeld()).toBe(true);
    process.env.PGI_MARKETING_HOLD = "off";
    expect(pgiMarketingHeld()).toBe(false);
  });
  it("stops the flow worker and the rep follow-up texts before they touch the database", async () => {
    delete process.env.PGI_MARKETING_HOLD;
    const db = { query: () => { throw new Error("must not query"); } } as any;
    expect(await runFlowTick(db, { send: async () => undefined, task: async () => ({ ok: true }) } as any)).toEqual({ held: 1 });
    expect(await runFollowUpSmsTick(db, async () => undefined)).toMatchObject({ sent: 0, skipped: true });
  });
});
