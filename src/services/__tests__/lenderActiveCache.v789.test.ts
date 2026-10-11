// BI_SERVER_v789 [52] active lender / contact check with a 30-second cache.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

import { lenderActiveState, resetLenderActiveCache, lenderContactIdFromClaims, LENDER_ACTIVE_TTL_MS } from "../lenderActiveCache";

let lender = true;
let contact = true;
beforeEach(() => {
  resetLenderActiveCache();
  lender = true;
  contact = true;
  queryMock.mockReset();
  queryMock.mockImplementation(answerBySql([
    [/FROM bi_lenders l/, (_s: string, p: unknown[]) => ({ rows: [{ lender_active: lender, contact_active: p[1] ? contact : null }], rowCount: 1 })],
  ]));
});

describe("lenderActiveState", () => {
  it("active / lender_inactive / contact_inactive", async () => {
    expect(await lenderActiveState("L1", "C1")).toBe("active");
    resetLenderActiveCache();
    lender = false;
    expect(await lenderActiveState("L1", "C1")).toBe("lender_inactive");
    resetLenderActiveCache();
    lender = true;
    contact = false;
    expect(await lenderActiveState("L1", "C1")).toBe("contact_inactive");
    resetLenderActiveCache();
    expect(await lenderActiveState("L1", null)).toBe("active"); // no contact in the token
  });

  it("an unknown lender is inactive", async () => {
    queryMock.mockImplementation(answerBySql([], { rows: [], rowCount: 0 }));
    expect(await lenderActiveState("nope", null)).toBe("lender_inactive");
  });

  it("a cache hit within 30s avoids a second query; after 30s it queries again", async () => {
    const t0 = 1_000_000;
    await lenderActiveState("L1", "C1", t0);
    await lenderActiveState("L1", "C1", t0 + LENDER_ACTIVE_TTL_MS - 1);
    expect(callsMatching(queryMock, /FROM bi_lenders l/)).toHaveLength(1);
    lender = false;
    expect(await lenderActiveState("L1", "C1", t0 + LENDER_ACTIVE_TTL_MS + 1)).toBe("lender_inactive");
    expect(callsMatching(queryMock, /FROM bi_lenders l/)).toHaveLength(2);
  });

  it("the cache is keyed by lender id + contact id", async () => {
    await lenderActiveState("L1", "C1");
    await lenderActiveState("L1", "C2");
    await lenderActiveState("L2", "C1");
    expect(callsMatching(queryMock, /FROM bi_lenders l/)).toHaveLength(3);
  });

  it("a database error is thrown and not cached", async () => {
    queryMock.mockRejectedValue(new Error("boom"));
    await expect(lenderActiveState("L1", null)).rejects.toThrow("boom");
    queryMock.mockImplementation(answerBySql([[/FROM bi_lenders l/, { rows: [{ lender_active: true, contact_active: null }] }]]));
    expect(await lenderActiveState("L1", null)).toBe("active");
  });

  it("reads the contact from user_id (SMS verify) or contactId (email verify)", () => {
    expect(lenderContactIdFromClaims({ user_id: "u" })).toBe("u");
    expect(lenderContactIdFromClaims({ contactId: "c" })).toBe("c");
    expect(lenderContactIdFromClaims({})).toBeNull();
  });
});
