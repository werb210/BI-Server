// BI_SERVER_v789 [58] lender carrier submit: carrier_received_at only on
// success; a failure writes a carrier_submission_failed bi_events row (logged
// when that insert fails); the response carries a code, not the carrier text.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerBySql, callsMatching, rejects } from "../../__tests__/helpers/answerBySql";

const h = vi.hoisted(() => ({ queryMock: vi.fn(), pgiSubmit: vi.fn(), logError: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => h.queryMock(...args) } }));
vi.mock("../pgiAdapter", () => ({ pgiSubmit: (...a: unknown[]) => h.pgiSubmit(...a) }));
vi.mock("../../platform/logger", () => ({ logger: { error: (...a: unknown[]) => h.logError(...a), warn: vi.fn(), info: vi.fn() } }));

import { submitLenderApplicationToCarrier } from "../lenderCarrierSubmit";

const input = (isDemo = false) => ({
  applicationId: "app-1",
  publicId: "CODE1",
  isDemo,
  guarantor_name: "G",
  guarantor_email: "g@x.test",
  business_name: "B",
  lender_name: "L",
  rowSnapshot: { id: "app-1", public_id: "CODE1" },
  formData: {},
  declarations: {},
});

beforeEach(() => {
  h.queryMock.mockReset();
  h.queryMock.mockImplementation(answerBySql([]));
  h.pgiSubmit.mockReset();
  h.logError.mockReset();
});

function appUpdate(): [string, unknown[]] {
  return callsMatching(h.queryMock, "UPDATE bi_applications")[0] as [string, unknown[]];
}

describe("submitLenderApplicationToCarrier", () => {
  it("success: carrier_received_at set (pgi id present), no failure event", async () => {
    h.pgiSubmit.mockResolvedValue({ application_id: "PGI-1", status: "received" });
    const r = await submitLenderApplicationToCarrier(input());
    expect(r.pgi_application_id).toBe("PGI-1");
    expect(r.pgi_error).toBeNull();
    const [sql, params] = appUpdate();
    expect(sql).toMatch(/carrier_received_at = CASE WHEN \$1::text IS NOT NULL THEN NOW\(\) ELSE carrier_received_at END/);
    expect(params[0]).toBe("PGI-1");
    expect(callsMatching(h.queryMock, "bi_events")).toHaveLength(0);
  });

  it("failure: carrier_received_at untouched, event written, response has a code only", async () => {
    h.pgiSubmit.mockRejectedValue(new Error("PGI submit failed: 502 secret upstream"));
    const r = await submitLenderApplicationToCarrier(input());
    expect(r.pgi_application_id).toBeNull();
    expect(r.pgi_error).toBe("carrier_submit_failed");
    const [, params] = appUpdate();
    expect(params[0]).toBeNull(); // CASE keeps the existing carrier_received_at
    expect(params[2]).toBe("submit_failed");
    const ev = callsMatching(h.queryMock, "INSERT INTO bi_events")[0] as [string, unknown[]];
    expect(ev[0]).toContain("'carrier_submission_failed'");
    expect(ev[0]).toContain("'bi'");
    expect(ev[1][0]).toBe("app-1");
    expect(JSON.parse(String(ev[1][1]))).toMatchObject({ source: "lender", public_id: "CODE1" });
  });

  it("a carrier reply without an application_id counts as a failure", async () => {
    h.pgiSubmit.mockResolvedValue({ status: "error" });
    const r = await submitLenderApplicationToCarrier(input());
    expect(r.pgi_error).toBe("carrier_submit_failed");
    expect(callsMatching(h.queryMock, "INSERT INTO bi_events")).toHaveLength(1);
  });

  it("a failing bi_events insert is logged and does not throw", async () => {
    h.pgiSubmit.mockRejectedValue(new Error("down"));
    h.queryMock.mockImplementation(answerBySql([["INSERT INTO bi_events", rejects(new Error("events table gone"))]]));
    const r = await submitLenderApplicationToCarrier(input());
    expect(r.pgi_error).toBe("carrier_submit_failed");
    expect(h.logError.mock.calls.some((c) => c[1] === "lender_carrier_failure_event_insert_failed")).toBe(true);
  });

  it("demo never calls the live adapter", async () => {
    const r = await submitLenderApplicationToCarrier(input(true));
    expect(h.pgiSubmit).not.toHaveBeenCalled();
    expect(r.pgi_application_id).toBe("DEMO_CODE1");
  });
});
