import { Router } from "express";
import { pool as sharedPool } from "../db"; // BI_SERVER_ONE_POOL_v718 - one pool for the whole server
import { env } from "../platform/env";
import { ok, badRequest } from "../utils/apiResponse";

const router = Router();
const db = sharedPool /* BI_SERVER_ONE_POOL_v718 */;

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
