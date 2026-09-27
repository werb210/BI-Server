// BI_SERVER_BLOCK_v612 - applicant message relay and routes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { relayApplicantMessages, serviceCallIsAuthorized } from "../biApplicantMessages";

const PHONE = "+17805551212";
afterEach(() => { delete process.env.BACKEND_SERVICE_TOKEN; });

describe("BI message relay", () => {
  it("calls BF-Server's bridge by subpath with the applicant phone and token", async () => {
    process.env.BACKEND_SERVICE_TOKEN = "tok-123";
    const f = vi.fn(async () => new Response(JSON.stringify({ unreadCount: 2 }), { status: 200 }));
    const r = await relayApplicantMessages(PHONE, "GET", undefined, f as any, "/unread");
    expect(r.body).toEqual({ unreadCount: 2 });
    const [url, init] = (f.mock.calls[0] as any);
    expect(url).toMatch(/\/api\/service\/applicant-messages\/unread$/);
    expect(init.headers).toMatchObject({ "x-backend-token": "tok-123", "x-applicant-phone": PHONE });
  });

  it("accepts BF-Server's staff-reply call in any of its token headers", () => {
    process.env.BACKEND_SERVICE_TOKEN = "tok-123";
    expect(serviceCallIsAuthorized({ authorization: "Bearer tok-123" })).toBe(true);
    expect(serviceCallIsAuthorized({ xServiceToken: "tok-123" })).toBe(true);
    expect(serviceCallIsAuthorized({ authorization: "Bearer nope" })).toBe(false);
    const routes = readFileSync("src/routes/biApplicantMessageRoutes.ts", "utf8");
    for (const p of ['"/applicants/messages/unread-count"', '"/applicants/messages/read"', '"/bi/applicant-messages/from-bf"', 'upload.array("files", 3)']) expect(routes).toContain(p);
  });
});

describe("BI message routes over HTTP", () => {
  it("turns the app's multipart send into the bridge payload, and guards the BF notice", async () => {
    process.env.BACKEND_SERVICE_TOKEN = "tok-123";
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { env } = await import("../../platform/env");
    const router = (await import("../../routes/biApplicantMessageRoutes")).default;
    const f = vi.fn(async (_url: string, init: any) => new Response(JSON.stringify({ ok: true, id: "m1", echo: JSON.parse(init.body) }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    const app = express(); app.use(express.json()); app.use("/api/v1", router);
    const token = jwt.sign({ kind: "applicant", phone: PHONE }, env.JWT_SECRET || "dev-missing-jwt-secret");
    const sent = await request(app).post("/api/v1/applicants/messages").set("Authorization", `Bearer ${token}`)
      .field("message", "Here is my contract").attach("files", Buffer.from("%PDF-1.4"), { filename: "c.pdf", contentType: "application/pdf" });
    expect(sent.status).toBe(201);
    expect(sent.body.echo.body).toBe("Here is my contract");
    expect(sent.body.echo.attachments[0]).toMatchObject({ name: "c.pdf", contentType: "application/pdf" });
    expect(sent.body.echo.attachments[0].dataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect((await request(app).post("/api/v1/bi/applicant-messages/from-bf").send({ phone: PHONE, body: "hi" })).status).toBe(401);
    vi.unstubAllGlobals();
  });
});
