// BI_SERVER_BLOCK_v358_CARRIER_ENVELOPE_FIX_v1
import { describe, it, expect } from "vitest";
import { buildCarrierPayloadV2 } from "../pgiCarrierMapper";

const row = { guarantor_name: "Sarah Chen", guarantor_email: "sarah@example.com", business_name: "Maple Leaf Inc.", lender_name: "Acme Bank" };
const decl = { section_1_a: "yes", section_1_2: "no", section_2_a: "no", section_2_b: "no", section_2_c: "no", section_2_d: "no", section_3_a: "no", section_3_c: "Agree", section_4_a: "no", section_5_a: "no", section_6_a: "yes" };

describe("v358 — buildCarrierPayloadV2 returns the full carrier envelope", () => {
  it("includes top-level guarantor_name / guarantor_email / business_name / lender_name when passed", () => {
    const out: any = buildCarrierPayloadV2(row as any, {} as any, decl as any, { guarantor_name: "Sarah Chen", guarantor_email: "sarah@example.com", business_name: "Maple Leaf Inc.", lender_name: "Acme Bank" });
    expect(out.guarantor_name).toBe("Sarah Chen");
    expect(out.guarantor_email).toBe("sarah@example.com");
    expect(out.business_name).toBe("Maple Leaf Inc.");
    expect(out.lender_name).toBe("Acme Bank");
    expect(out.form_data).toBeDefined();
    expect(out.form_data.q2_full_name).toBe("Sarah Chen");
  });
  it("falls back to row/data fields when top isn't passed", () => {
    const out: any = buildCarrierPayloadV2(row as any, {} as any, decl as any);
    expect(out.guarantor_name).toBe("Sarah Chen");
    expect(out.business_name).toBe("Maple Leaf Inc.");
  });
  it("doesn't emit empty top-level keys", () => {
    const out: any = buildCarrierPayloadV2({} as any, {} as any, decl as any, {});
    expect("guarantor_name" in out).toBe(false);
    expect("lender_name" in out).toBe(false);
    expect(out.form_data).toBeDefined();
  });
});
