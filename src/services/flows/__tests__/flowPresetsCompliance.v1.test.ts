// BI_SERVER_PGI_COMPLIANCE_v1 - PGI Canada Ltd.'s notice of 2026-11-19: the starting flow emails carry only what PGI
// authorized and name the licensed broker.
import { describe, expect, it } from "vitest";
import { FLOW_PRESETS } from "../flowPresets";

const BANNED = [
  /2\.6%|2\.7%|about 2%|~2%/, /EBITDA|12\+ months/, /pays (the|toward the) (bank|lender|guarantee)/i, /stronger guarantee|better.quality/i,
  /referral fee|commission|you earn/i, /Markel/, /home is no longer|savings/i, /approve files|close more|win more/i,
  /80%|90%|70%|\$1,000,000|\$5,000,000/, /negotiating leverage/i, /Boreal Insurance/,
];

describe("flow presets", () => {
  for (const f of FLOW_PRESETS) {
    it(`${f.name} carries only authorized statements`, () => {
      const all = Object.values(f.emails).map((e) => `${e.subject} ${e.body}`).join(" ");
      for (const re of BANNED) expect(all, `${f.name} matches ${re}`).not.toMatch(re);
      expect(all).toMatch(f.market === "CA" ? /PGI Canada Ltd\./ : /PGI America Ltd\./);
      if (f.market === "US") expect(all).not.toMatch(/1\.8%/);
      if (f.market === "CA") expect(f.link_url).toBe("https://www.boreal.insure"); // BI_SERVER_OWN_APPLICATION_v1
    });
  }
});
