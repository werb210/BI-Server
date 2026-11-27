// BI_SERVER_EMAIL_FLOWS_v1 - the rules of an email flow.
import { describe, expect, it } from "vitest";
import { firstRealClick } from "../services/flows/robotClicks";
import { addBusinessDays, dailyNewCap, flowJobId, htmlToText, isRobotClick, nextAfterSend, onClick, onOpen, parseFlowJobId, withFooter } from "../services/flows/flowEngine";
import { FLOW_PRESETS } from "../services/flows/flowPresets";

const MON_10 = new Date("2026-11-23T16:00:00Z"); // Monday 10:00 in Alberta

describe("what comes next in a flow", () => {
  it("someone who never opens gets three more short emails, a week apart, then nothing", () => {
    const n2 = nextAfterSend("e1", "none", MON_10)!;
    expect(n2.key).toBe("n2");
    expect(n2.at.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    expect(nextAfterSend("n2", "none", MON_10)!.key).toBe("n3");
    expect(nextAfterSend("n3", "none", MON_10)!.key).toBe("n4");
    expect(nextAfterSend("n4", "none", MON_10)).toBeNull();
  });
  it("an open moves them to the details email two business days later, then one example, then nothing", () => {
    const fri = new Date("2026-11-27T18:00:00Z");
    const moved = onOpen({ track: "none", sentKeys: ["e1"], lastSentAt: MON_10 }, fri)!;
    expect(moved.track).toBe("opened");
    expect(moved.next).toEqual({ key: "o1", at: new Date("2026-12-01T18:00:00Z") }); // Friday + 2 business days = Tuesday
    expect(onOpen({ track: "opened", sentKeys: ["e1", "o1"], lastSentAt: MON_10 }, fri)).toBeNull();
    expect(onOpen({ track: "none", sentKeys: [], lastSentAt: null }, fri)).toBeNull();
    expect(nextAfterSend("o1", "opened", MON_10)!.key).toBe("o2");
    expect(nextAfterSend("o2", "opened", MON_10)).toBeNull();
  });
  it("a real click sends the let's-talk email in sending hours; nothing follows it", () => {
    const sat = new Date("2026-11-28T20:00:00Z");
    const moved = onClick({ track: "opened", sentKeys: ["e1", "o1"], lastSentAt: MON_10 }, { at: sat, url: "https://www.boreal.insure/us-lenders" })!;
    expect(moved.track).toBe("clicked");
    expect(moved.next!.key).toBe("c1");
    expect(moved.next!.at.toISOString()).toBe("2026-11-30T15:00:00.000Z"); // Saturday -> Monday 9:00
    expect(nextAfterSend("c1", "clicked", MON_10)).toBeNull();
    expect(onClick({ track: "clicked", sentKeys: ["e1", "c1"], lastSentAt: MON_10 }, { at: sat, url: "https://x.test" })).toBeNull();
  });
  it("ignores a mail filter's click and an unsubscribe click", () => {
    const m = { track: "none" as const, sentKeys: ["e1"], lastSentAt: MON_10 };
    expect(onClick(m, { at: new Date(MON_10.getTime() + 20_000), url: "https://www.boreal.insure/ca" })).toBeNull();
    const later = new Date(MON_10.getTime() + 3_600_000);
    const burst = ["a", "b", "c"].map((p) => ({ at: later, url: `https://x.test/${p}` }));
    expect(isRobotClick(burst[0]!, MON_10, burst)).toBe(true);
    expect(onClick(m, burst[0]!, burst)).toBeNull();
    expect(onClick(m, { at: later, url: "https://u.sendgrid.net/wf/unsubscribe?x=1" })).toBeNull();
    expect(onClick(m, { at: later, url: "https://www.boreal.insure/ca" })!.track).toBe("clicked");
  });
  // BI_SERVER_ROBOT_CLICKS_v2
  it("a click within 5 minutes, or within the hour with no open first, is a scanner", () => {
    const at = (min: number) => ({ at: new Date(MON_10.getTime() + min * 60_000), url: "https://www.boreal.insure/ca" });
    expect(isRobotClick(at(4), MON_10, [], true)).toBe(true);
    expect(isRobotClick(at(6), MON_10, [], true)).toBe(false);
    expect(isRobotClick(at(30), MON_10, [], false)).toBe(true);
    expect(isRobotClick(at(90), MON_10, [], false)).toBe(false);
    expect(onClick({ track: "none", sentKeys: ["e1"], lastSentAt: MON_10 }, at(30))).toBeNull();
    expect(onClick({ track: "opened", sentKeys: ["e1"], lastSentAt: MON_10 }, at(30))!.track).toBe("clicked");
    const job = "flow:11111111-2222-3333-4444-555555555555:e1";
    const ev = (type: string, min: number) => ({ job_id: job, event_type: type, at: new Date(MON_10.getTime() + min * 60_000), detail: JSON.stringify({ url: "https://www.boreal.insure/ca" }) });
    expect(firstRealClick([ev("delivered", 0), ev("click", 2), ev("click", 20)])).toBeNull();
    expect(firstRealClick([ev("delivered", 0), ev("click", 2), ev("open", 10), ev("click", 20)])?.getTime()).toBe(MON_10.getTime() + 20 * 60_000);
  });
  it("business days skip the weekend, and the daily number doubles each week up to 1,000", () => {
    expect(addBusinessDays(new Date("2026-11-26T18:00:00Z"), 2).toISOString()).toBe("2026-11-30T18:00:00.000Z");
    expect(dailyNewCap(100, null, MON_10)).toBe(100);
    expect(dailyNewCap(100, MON_10, new Date(MON_10.getTime() + 6 * 86_400_000))).toBe(100);
    expect(dailyNewCap(100, MON_10, new Date(MON_10.getTime() + 8 * 86_400_000))).toBe(200);
    expect(dailyNewCap(100, MON_10, new Date(MON_10.getTime() + 60 * 86_400_000))).toBe(1000);
  });
  it("tags every email so its opens and clicks come back to the right flow", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseFlowJobId(flowJobId(id, "o1"))).toEqual({ flowId: id, key: "o1" });
    expect(parseFlowJobId("campaign-7")).toBeNull();
  });
  it("every ready-made flow has all seven emails, each with a link, and the footer carries the postal address", () => {
    for (const preset of FLOW_PRESETS) {
      for (const key of ["e1", "n2", "n3", "n4", "o1", "o2", "c1"] as const) {
        const e = preset.emails[key];
        expect(e.subject.length, `${preset.key}.${key}`).toBeGreaterThan(5);
        expect(e.body, `${preset.key}.${key}`).toMatch(/\{\{(link|booking_link)\}\}/);
        expect(e.body).toContain("{{first_name}}");
      }
    }
    const us = FLOW_PRESETS.find((x) => x.key === "lender_us")!;
    const ca = FLOW_PRESETS.find((x) => x.key === "lender_ca")!;
    // BI_SERVER_PGI_COMPLIANCE_v1 - only the authorized Canadian rate line; no US figures (PGI notice 2026-11-19).
    expect(us.emails.e1.body).toContain("PGI America Ltd.");
    expect(us.emails.e1.body).not.toMatch(/%/);
    expect(ca.emails.e1.body).toContain("Rates start as low as 1.8% of the limit of insurance.");
    expect(ca.emails.e1.body).toContain("PGI Canada Ltd.");
    expect(ca.emails.n3.body).not.toContain("SBA");
    const html = withFooter("<p>Hello</p>", "Andrew");
    expect(html).toContain("450 Sparling Crt SW");
    expect(htmlToText('<p>See <a href="https://x.test">this</a></p>')).toBe("See this: https://x.test");
  });
});
