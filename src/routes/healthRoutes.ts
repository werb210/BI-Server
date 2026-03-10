import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.get("/health", async (_req, res) => {

  try {

    await db.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
      uptime: process.uptime()
    });

  } catch (err) {

    res.status(500).json({
      status: "error",
      database: "disconnected"
    });

  }

});

export default router;
