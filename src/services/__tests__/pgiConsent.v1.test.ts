// BI_SERVER_PGI_CONSENT_GATE_v1
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: new Map<string, any>(), sent: [] as any[], carrier: vi.fn(), pgi: vi.fn() }));

vi.mock("../../db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const id = params[0];
      if (/AS pgi_consent_ok/.test(sql)) {
        const d = h.rows.get(id)?.data ?? {};
        const ok = d.consent_evidence?.fee_disclosure?.accepted === true && d.consent_evidence?.share_with_pgi?.accepted === true;
        return { rows: h.rows.has(id) ? [{ pgi_consent_ok: ok }] : [] };
      }
      if (/AS req\b/.test(sql)) {
        const r = h.rows.get(id);
        return { rows: r ? [{ ...r, email: r.guarantor_email, business: r.business_name, req: r.data.consent_request ?? null }] : [] };
      }
      if (/'\{consent_request\}'/.test(sql)) { h.rows.get(id).data.consent_request = JSON.parse(params[1]); return { rows: [] }; }
      if (/'\{consent_evidence\}'/.test(sql)) { h.rows.get(id).data.consent_evidence = JSON.parse(params[1]); return { rows: [] }; }
      if (/consent_request'->>'token' = \$1/.test(sql)) {
        for (const [rid, r] of h.rows) if (r.data.consent_request?.token === params[0]) {
          return { rows: [{ id: rid, guarantor_name: r.guarantor_name, business: r.business_name, country: r.country, done: r.data.consent_evidence?.share_with_pgi?.accepted === true }] };
        }
        return { rows: [] };
      }
      if (/AS resume/.test(sql)) return { rows: [{ resume: h.rows.get(id)?.data.consent_request?.resume ?? null }] };
      return { rows: [] };
    }),
  },
}));
vi.mock("../biSendgridService", () => ({
  sendgridConfigured: () => true,
  sendBiMarketingEmail: async (m: any) => { h.sent.push(m); return { status: "accepted", statusCode: 202 }; },
}));
vi.mock("../lenderCarrierSubmit", () => ({ submitLenderApplicationToCarrier: h.carrier }));
vi.mock("../biPgiSubmissionService", () => ({ submitApplicationToPGI: h.pgi }));

import { acceptConsent, consentEvidence, feeDisclosureText, getConsentRequest, hasPgiConsent, requestPgiConsent } from "../pgiConsent";

beforeEach(() => {
  h.rows.clear(); h.sent.length = 0; h.carrier.mockReset(); h.pgi.mockReset();
  h.rows.set("a1", { guarantor_name: "Sarah Chen", guarantor_email: "sarah@example.com", business_name: "Lone Star", country: "CA", data: {} });
});

describe("PGI consent gate", () => {
  it("no consent on file until both parts are accepted", async () => {
    expect(await hasPgiConsent("a1")).toBe(false);
    h.rows.get("a1").data.consent_evidence = consentEvidence({ via: "test" });
    expect(await hasPgiConsent("a1")).toBe(true);
  });

  it("emails the guarantor once a day, reusing the same link", async () => {
    await requestPgiConsent("a1", { path: "lender", input: { applicationId: "a1" } });
    await requestPgiConsent("a1", { path: "lender", input: { applicationId: "a1" } });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("sarah@example.com");
    expect(h.sent[0].transactional).toBe(true);
    const token = h.rows.get("a1").data.consent_request.token;
    expect(h.sent[0].text).toContain(`/consent/${token}`);
    expect(h.sent[0].text).toContain("never a condition of your loan");
  });

  it("the consent page shows the disclosure; accepting records it and sends the held file", async () => {
    await requestPgiConsent("a1", { path: "lender", input: { applicationId: "a1", isDemo: false } });
    const token = h.rows.get("a1").data.consent_request.token;
    const page = await getConsentRequest(token);
    expect(page?.feeDisclosure).toBe(feeDisclosureText("CA"));
    expect(page?.feeDisclosure).toMatch(/may receive a fee from PGI Canada Ltd\./);
    expect(page?.alreadyConfirmed).toBe(false);
    const r = await acceptConsent(token, { ip: "1.2.3.4", userAgent: "ua" });
    expect(r.ok).toBe(true);
    expect(await hasPgiConsent("a1")).toBe(true);
    expect(h.rows.get("a1").data.consent_evidence.via).toBe("guarantor_link");
    expect(h.carrier).toHaveBeenCalledWith({ applicationId: "a1", isDemo: false });
  });

  it("a staff/public file resumes through the PGI submit", async () => {
    await requestPgiConsent("a1", { path: "pgi" });
    await acceptConsent(h.rows.get("a1").data.consent_request.token, {});
    expect(h.pgi).toHaveBeenCalledWith("a1");
  });

  it("unknown or malformed links are refused", async () => {
    expect(await getConsentRequest("short")).toBeNull();
    expect((await acceptConsent("x".repeat(32), {})).ok).toBe(false);
  });

  it("US files name PGI America Ltd.", () => {
    expect(feeDisclosureText("US")).toMatch(/PGI America Ltd\./);
  });
});
