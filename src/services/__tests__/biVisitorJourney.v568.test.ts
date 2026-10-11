// BI_SERVER_BLOCK_v568_BI_VISITOR_JOURNEY
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { answerBySql, callsMatching } from "../../__tests__/helpers/answerBySql";
import { parseJourneyBody, publicIdFromPath, summarise } from "../biVisitorJourney";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({
  pool: {
    query: (...a: unknown[]) => queryMock(...a),
    connect: async () => ({ query: (...a: unknown[]) => queryMock(...a), release: () => undefined }),
  },
  runMigrations: async () => undefined,
}));

import app from "../../server";

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
  // v789 [5]/[37]: was a grep of server.ts; now requests against the real app.
  it("collector is public and above the auth mounts; journey read is staff-only", async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(answerBySql([]));
    const beacon = JSON.stringify({ sessionId: "sess-1", events: [{ type: "pageview", path: "/applications/PGI-7K2Q/form" }] });
    const collected = await request(app).post("/api/v1/bi/track/journey").set("Content-Type", "text/plain").send(beacon);
    expect(collected.status).toBe(200);
    expect(collected.body).toEqual({ ok: true, events: 1 });
    const session = callsMatching(queryMock, "INSERT INTO bi_visitor_sessions");
    expect(session).toHaveLength(1);
    expect((session[0]![1] as unknown[]).slice(0, 2)).toEqual(["sess-1", "PGI-7K2Q"]);

    const contact = "11111111-1111-4111-8111-111111111111";
    expect((await request(app).get(`/api/v1/bi/crm/contacts/${contact}/journey`)).status).toBe(401);
    const applicant = jwt.sign({ kind: "applicant", phone: "+15875550000" }, process.env.JWT_SECRET as string);
    expect((await request(app).get(`/api/v1/bi/crm/contacts/${contact}/journey`).set("Authorization", `Bearer ${applicant}`)).status).toBe(403);
    const staff = jwt.sign({ sub: "staff-1", role: "Staff" }, process.env.JWT_SECRET as string);
    const read = await request(app).get(`/api/v1/bi/crm/contacts/${contact}/journey`).set("Authorization", `Bearer ${staff}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ sessions: [], events: [], applications: [] });
  });
});
