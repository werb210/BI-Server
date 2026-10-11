// BI_SERVER_v789_ADMIN_OTP_LIMIT - /api/v1/admin-verify-otp: at most 5 attempts
// (successful or failed, all count) per admin email per 15 minutes, then 429
// until the window has passed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { answerBySql } from "../../__tests__/helpers/answerBySql";

const queryMock = vi.fn();
vi.mock("../../db", () => ({ pool: { query: (...a: unknown[]) => queryMock(...a) } }));

import router, { adminOtpAttempts } from "../mayaAnalytics";

const GOOD = "123456";
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/v1", router);
  return a;
}

beforeEach(() => {
  adminOtpAttempts.reset();
  queryMock.mockReset().mockImplementation(answerBySql([
    ["FROM admin_otp_codes", (_sql: string, params?: unknown[]) => ({ rows: params?.[1] === GOOD ? [{ id: 9 }] : [] })],
    ["SELECT role FROM admin_users", { rows: [{ role: "admin" }] }],
  ]));
});
afterEach(() => vi.useRealTimers());

const verify = (email: string, code: string) =>
  request(app()).post("/api/v1/admin-verify-otp").send({ email, code });

describe("admin OTP verify attempt limit", () => {
  it("allows 5 attempts, then 429 even for the right code", async () => {
    for (let i = 0; i < 5; i++) expect((await verify("boss@example.com", "000000")).status).toBe(400);
    const sixth = await verify("boss@example.com", GOOD);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("too_many_attempts");
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts successful attempts too and keys on the email case-insensitively", async () => {
    for (let i = 0; i < 5; i++) expect((await verify(i % 2 ? "Boss@Example.com" : "boss@example.com", GOOD)).status).toBe(200);
    expect((await verify("BOSS@example.com", GOOD)).status).toBe(429);
  });

  it("another admin is not affected", async () => {
    for (let i = 0; i < 6; i++) await verify("a@example.com", "000000");
    expect((await verify("b@example.com", GOOD)).status).toBe(200);
  });

  it("opens again once the 15 minute window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    for (let i = 0; i < 5; i++) await verify("c@example.com", "000000");
    expect((await verify("c@example.com", GOOD)).status).toBe(429);
    vi.setSystemTime(new Date("2026-10-11T10:14:59Z"));
    expect((await verify("c@example.com", GOOD)).status).toBe(429);
    vi.setSystemTime(new Date("2026-10-11T10:15:01Z"));
    expect((await verify("c@example.com", GOOD)).status).toBe(200);
  });

  it("a successful verify returns a token", async () => {
    const res = await verify("d@example.com", GOOD);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.token).toBe("string");
  });
});
