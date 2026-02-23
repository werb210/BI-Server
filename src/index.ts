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
import { submitClaim } from "./modules/claims.controller";
import { cancelPolicy } from "./modules/cancel.controller";
import { runPremiumAccrual } from "./worker/accrual.worker";
import {
  createPayoutBatch,
  markBatchPaid
} from "./modules/payout.controller";

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

    const jobStatus = await pool.query<{ status: string }>(
      `SELECT status FROM bi_jobs
       WHERE job_type='premium_accrual'
       ORDER BY created_at DESC
       LIMIT 1`
    );

    res.json({
      ready: true,
      worker: {
        premiumAccrual: jobStatus.rows[0]?.status ?? "never_run"
      }
    });
  } catch {
    res.status(500).json({ ready: false });
  }
});

app.post("/bi/quote", quoteHandler);
app.post("/bi/application", createApplication);
app.post("/bi/webhooks/purbeck", purbeckWebhook);
app.post("/bi/claims", submitClaim);

app.get("/bi/admin/applications", requireAdmin, getApplications);
app.get("/bi/admin/commissions", requireAdmin, getCommissions);
app.patch(
  "/bi/admin/application/:id/status",
  requireAdmin,
  updateUnderwritingStatus
);
app.patch("/bi/admin/policy/:id/cancel", requireAdmin, cancelPolicy);
app.post("/bi/admin/payout/batch", requireAdmin, createPayoutBatch);
app.patch("/bi/admin/payout/:id/pay", requireAdmin, markBatchPaid);

setInterval(() => {
  runPremiumAccrual();
}, 1000 * 60 * 60);

async function start() {
  await runSchema();
  app.listen(config.port, () => {
    console.log(`BI Server running on port ${config.port}`);
  });
}

start();
