// BI_SERVER_BLOCK_v302_APPLICATION_DELETE_ADMIN_v1
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import biApplicationRoutes from "../biApplicationRoutes";
import { pool } from "../../db";

vi.mock("../../db", async () => {
  const actual = await vi.importActual<any>("../../db");
  return {
    ...actual,
    pool: {
      query: vi.fn(),
    },
  };
});

function buildApp(role: string | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = role ? { role } : undefined;
    next();
  });
  app.use("/api/v1/bi", biApplicationRoutes);
  return app;
}

describe("DELETE /api/v1/bi/applications/:id", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await request(buildApp("Admin")).delete("/api/v1/bi/applications/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_id");
  });

  it("returns 403 for non-admin", async () => {
    const res = await request(buildApp("Staff")).delete(
      "/api/v1/bi/applications/11111111-1111-4111-8111-111111111111"
    );
    expect(res.status).toBe(403);
  });

  it("returns 410 when no row matched", async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp("Admin")).delete(
      "/api/v1/bi/applications/11111111-1111-4111-8111-111111111111"
    );
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("already_deleted");
  });

  it("returns 200 on successful delete", async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] });
    const res = await request(buildApp("Admin")).delete(
      "/api/v1/bi/applications/11111111-1111-4111-8111-111111111111"
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111" });
  });
});
