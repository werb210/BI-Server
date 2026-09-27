// BI_SERVER_BLOCK_v598
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { biRateLimiter } from "../middleware/biRateLimit";
import { httpLogLevel } from "../utils/httpLogger";

describe("BI rate limiter counts a request once", () => {
  it("does not charge a request again at every /api/v1/bi mount it passes", async () => {
    const app = express();
    const pass = express.Router();
    const hit = express.Router();
    hit.get("/applications", (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 5; i++) app.use("/api/v1/bi", biRateLimiter, pass);
    app.use("/api/v1/bi", biRateLimiter, hit);
    const a = await request(app).get("/api/v1/bi/applications");
    const b = await request(app).get("/api/v1/bi/applications");
    expect(a.status).toBe(200);
    const used = Number(a.headers["ratelimit-remaining"]) - Number(b.headers["ratelimit-remaining"]);
    expect(used).toBe(1);
  });
});

describe("probe requests stay out of the log", () => {
  const res = (statusCode: number) => ({ statusCode });
  it("silences successful Azure probes", () => {
    expect(httpLogLevel({ url: "/health", headers: { "user-agent": "HealthCheck/1.0" } }, res(200))).toBe("silent");
    expect(httpLogLevel({ url: "/", headers: { "user-agent": "AlwaysOn" } }, res(200))).toBe("silent");
  });
  it("still logs failing probes and real traffic", () => {
    expect(httpLogLevel({ url: "/health", headers: { "user-agent": "HealthCheck/1.0" } }, res(503))).toBe("error");
    expect(httpLogLevel({ url: "/health", headers: { "user-agent": "Mozilla/5.0" } }, res(200))).toBe("info");
    expect(httpLogLevel({ url: "/api/v1/bi/applications", headers: { "user-agent": "HealthCheck/1.0" } }, res(200))).toBe("info");
  });
});
