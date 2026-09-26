// BI_SERVER_BLOCK_v568_BI_VISITOR_JOURNEY
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJourneyBody, publicIdFromPath, summarise } from "../biVisitorJourney";

describe("v568 BI visitor journey", () => {
  it("accepts the beacon as text or JSON and caps it", () => {
    const body = { sessionId: "s1", events: [{ type: "pageview", path: "/faq", dwellMs: 1234.6 }, { type: "" }] };
    expect(parseJourneyBody(JSON.stringify(body))?.events).toEqual([{ type: "pageview", path: "/faq", title: null, step: null, dwellMs: 1235 }]);
    expect(parseJourneyBody(body)?.sessionId).toBe("s1");
    expect(parseJourneyBody("not json")).toBeNull();
    expect(parseJourneyBody({ events: [] })).toBeNull();
  });
  it("links a visit to the application from its URL", () => {
    expect(publicIdFromPath("/applications/PGI-7K2Q/form")).toBe("PGI-7K2Q");
    expect(publicIdFromPath("/applications/new")).toBeNull();
    expect(publicIdFromPath("/faq")).toBeNull();
  });
  it("summarises pages, time and where they left", () => {
    const s = summarise([
      { event_type: "pageview", path: "/", dwell_ms: 1000 },
      { event_type: "pageview", path: "/what-is-pgi", dwell_ms: 4000 },
    ]);
    expect(s).toMatchObject({ pageviewCount: 2, totalDwellMs: 5000, exitPage: "/what-is-pgi", submitted: false });
    expect(summarise([{ event_type: "pageview", path: "/applications/X1Y2/thanks", dwell_ms: 1 }]).submitted).toBe(true);
  });
  it("collector is public and above the auth mounts; journey read is staff-only", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const collector = server.indexOf('app.use("/api/v1/bi", biCors, biVisitorTrackRoutes)');
    const firstAuth = server.indexOf('app.use("/api/v1/bi", requireAuth');
    expect(collector).toBeGreaterThan(0);
    expect(collector).toBeLessThan(firstAuth);
    expect(server).toContain('app.use("/api/v1/bi", requireAuth, biContactAnalyticsRoutes)');
  });
});
