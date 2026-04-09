import express from "express";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";

const router = express.Router();

router.get("/", (_req, res) => {
  return ok(res, {
    service: "bi-server",
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

router.get("/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    return ok(res, {
      database: "ok"
    });
  } catch {
    return badRequest(res, "db-failed");
  }
});

export default router;
