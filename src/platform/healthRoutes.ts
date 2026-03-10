import express from "express";
import { pool } from "../db";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    service: "bi-server",
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

router.get("/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "db-ok"
    });
  } catch {
    res.status(500).json({
      status: "db-failed"
    });
  }
});

export default router;
