import request from "supertest";
import app from "../../server";

describe("POST /api/v1/referrer/referrals — v320 ON CONFLICT fix", () => {
  it("returns 201 on first save with email+phone", async () => {
    const r = await request(app).post("/api/v1/referrer/referrals").set("Authorization", "Bearer <referrer-test-token>").send({ full_name: "Bob Test", email: "bob@example.com", phone: "+15551110001" });
    expect(r.status).toBe(201);
  });
});
