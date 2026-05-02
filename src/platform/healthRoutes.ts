import express from "express";
import { pool } from "../db";
import { badRequest } from "../utils/apiResponse";

const router = express.Router();

// BI_BOOT_FIX_v62_HEALTH — /health is the Azure liveness probe. It must
// return 200 fast, even when the DB is still warming up. The /ready
// endpoint below is the readiness probe and DOES check the DB.
router.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "bi-server",
    build: process.env.BUILD_TAG || "unknown",
    sha: (process.env.COMMIT_SHA || "unknown").slice(0, 8),
    uptime_s: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

// Readiness — DB-aware. Use this for "is the app actually serving?".
router.get("/ready", async (_req, res) => {
  try {
    const { pool } = await import("../db");
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ready-check db timeout")), 3000)),
    ]);
    res.status(200).json({ status: "ready" });
  } catch (err) {
    res.status(503).json({
      status: "not-ready",
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
});

router.get("/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({
      database: "ok"
    });
  } catch {
    return badRequest(res, "db-failed");
  }
});

export default router;
