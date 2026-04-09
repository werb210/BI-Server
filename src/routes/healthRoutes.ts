import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";
import { ok, badRequest } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    return ok(res, {
      database: "connected",
      uptime: process.uptime()
    });
  } catch {
    return badRequest(res, "Database disconnected");
  }
});

export default router;
