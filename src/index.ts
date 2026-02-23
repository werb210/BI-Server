import express from "express";
import cors from "cors";
import { config } from "./config/env";
import { runSchema } from "./db/schema";
import { quoteHandler } from "./modules/quote.controller";
import { createApplication } from "./modules/application.controller";
import { getApplications, getCommissions } from "./modules/admin.controller";

const app = express();

app.use(cors({
  origin: [
    "https://boreal.financial",
    "https://boreal.insure",
    "http://localhost:3000"
  ]
}));

app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));
app.get("/ready", (_, res) => res.json({ ready: true }));

app.post("/bi/quote", quoteHandler);
app.post("/bi/application", createApplication);

app.get("/bi/admin/applications", getApplications);
app.get("/bi/admin/commissions", getCommissions);

async function start() {
  await runSchema();
  app.listen(config.port, () => {
    console.log(`BI Server running on port ${config.port}`);
  });
}

start();
