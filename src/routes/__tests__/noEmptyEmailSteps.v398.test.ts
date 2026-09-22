// BI_SERVER_NO_EMPTY_EMAIL_STEPS_v398
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args), connect: vi.fn() } }));
vi.mock("../../platform/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import marketing from "../biMarketingRoutes";
import sequences from "../biSequencesRoutes";
import { emptyStepsMessage } from "../../services/emptyEmailSteps";

const app = () => { const a = express(); a.use(express.json()); a.use(marketing); a.use(sequences); return a; };

beforeEach(() => queryMock.mockReset());

describe("a sequence with empty email steps cannot run", () => {
  it("Start is refused with the step numbers", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ position: 0 }, { position: 1 }, { position: 2 }] })
      .mockResolvedValueOnce({ rows: [{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3 }] });
    const res = await request(app()).post("/sequences/s1/start");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("empty_email_steps");
    expect(res.body.error.steps).toEqual([1, 2, 3]);
    expect(res.body.message).toMatch(/^Steps 1, 2, 3 are emails/);
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes("SET status = 'active'"))).toBe(false);
  });
  it("Start goes ahead when every email step has content", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ position: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "s1" }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post("/sequences/s1/start");
    expect(res.status).toBe(200);
  });
  it("adding a blank email step is refused", async () => {
    const res = await request(app()).post("/sequences/s1/steps").send({ type: "email", position: 1 });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
  it("a step's template is remembered", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subject: "Hi", body: "<p>Hello</p>" }] })
      .mockResolvedValueOnce({ rows: [{ id: "st1" }] });
    const res = await request(app()).post("/sequences/s1/steps").send({ type: "email", template_id: "t9" });
    expect(res.status).toBe(201);
    const insert = queryMock.mock.calls[1];
    expect(JSON.parse(insert[1][7])).toEqual({ template_id: "t9" });
  });
  it("explains the problem plainly", () => {
    expect(emptyStepsMessage([1])).toMatch(/^Step 1 is an email with no subject or message/);
    expect(emptyStepsMessage([1, 2, 3])).toMatch(/^Steps 1, 2, 3 are emails/);
  });
});
