// BI_SERVER_BLOCK_v369_MAPPER_SAFE_DEFAULTS_v1
import { describe, it, expect } from "vitest";
import { buildCarrierPayloadV2 } from "../pgiCarrierMapper";

describe("v369 — carrier mapper safe declaration defaults", () => {
  it("omits declarations entirely when none passed (no silent 'no')", () => {
    const out: any = buildCarrierPayloadV2(
      { guarantor_name: "X", business_name: "Y" } as any,
      {} as any,
      {} as any
    );
    expect(out.form_data.section_6_a).toBeUndefined();
    expect(out.form_data.section_1_a).toBeUndefined();
    expect(out.form_data.section_1_2).toBeUndefined();
  });
  it("populates only the declarations explicitly provided", () => {
    const out: any = buildCarrierPayloadV2(
      { guarantor_name: "X", business_name: "Y" } as any,
      {} as any,
      { section_6_a: "yes", section_3_c: "Agree" } as any
    );
    expect(out.form_data.section_6_a).toBe("yes");
    expect(out.form_data.section_3_c).toBe("Agree");
    expect(out.form_data.section_1_a).toBeUndefined();
  });
});
