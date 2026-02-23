import express from "express";
import cors from "cors";
import { config } from "./config/env";
import { runSchema } from "./db/schema";
import { quoteHandler } from "./modules/quote.controller";
import { createApplication } from "./modules/application.controller";
import { getApplications, getCommissions } from "./modules/admin.controller";
import { updateUnderwritingStatus } from "./modules/underwriting.controller";
import { purbeckWebhook } from "./modules/webhook.controller";
import { requireAdmin } from "./middleware/requireAdmin";
import { pool } from "./db";

const app = express();

app.use(
  cors({
    origin: [
      "https://boreal.financial",
      "https://boreal.insure",
      "http://localhost:3000"
    ]
  })
);

app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));
app.get("/ready", async (_, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ready: true });
  } catch {
    res.status(500).json({ ready: false });
  }
});

app.post("/bi/quote", quoteHandler);
app.post("/bi/application", createApplication);
app.post("/bi/webhooks/purbeck", purbeckWebhook);

app.get("/bi/admin/applications", requireAdmin, getApplications);
app.get("/bi/admin/commissions", requireAdmin, getCommissions);
app.patch(
  "/bi/admin/application/:id/status",
  requireAdmin,
  updateUnderwritingStatus
);

async function start() {
  await runSchema();
  app.listen(config.port, () => {
    console.log(`BI Server running on port ${config.port}`);
  });
}

start();
