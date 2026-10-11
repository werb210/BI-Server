import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { mayaScrapeFinancials } from "../services/mayaOcr";
import { passesScoreGate } from "../services/biPublicFormGates";
import { rateLimitKeyFromRequest } from "../middleware/rateLimitKey";

// BI_SERVER_v784_SCRAPE_GATE
// This route is public, accepts 25 MB and forwards the file to OpenAI. It used
// to read the upload before checking anything, so anyone could burn OCR spend
// with a made-up publicId. Now, before multer reads a byte:
//   1) the publicId must exist, pass the score gate and be in an open status
//   2) at most 5 scrapes per hour per IP
//   3) at most 10 scrapes per day per application
const SCRAPE_STATUSES = new Set(["created", "in_progress", "document_review"]);
const IP_LIMIT_PER_HOUR = 5;
const APP_LIMIT_PER_DAY = 10;

type ScrapeReq = Request & { scrapeApplicationId?: string };

async function scrapeGate(req: ScrapeReq, res: Response, next: NextFunction) {
  const r = await pool.query<{ id: string; score_decision: string | null; status: string | null; source: string | null }>(
    `SELECT id, score_decision, status, source FROM bi_applications WHERE public_id=$1`,
    [req.params.publicId],
  );
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  if (!passesScoreGate(app)) return res.status(403).json({ error: "score_not_approved" });
  const status = String(app.status ?? "").toLowerCase();
  if (!SCRAPE_STATUSES.has(status)) return res.status(409).json({ error: "wrong_status", current: status });
  req.scrapeApplicationId = String(app.id);
  return next();
}

export function createScrapeRouter(): Router {
  const router = Router();
  const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

  const ipLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: IP_LIMIT_PER_HOUR,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `scrape-ip:${rateLimitKeyFromRequest(req)}`,
    handler: (_req, res) => { res.status(429).json({ error: "rate_limited", scope: "ip" }); },
  });
  const appLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: APP_LIMIT_PER_DAY,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `scrape-app:${(req as ScrapeReq).scrapeApplicationId ?? ""}`,
    handler: (_req, res) => { res.status(429).json({ error: "rate_limited", scope: "application" }); },
  });

  router.post("/applications/:publicId/scrape", scrapeGate, ipLimiter, appLimiter, upload.single("file"), async (req, res) => {
    const f = (req as any).file;
    if (!f) return res.status(400).json({ error: "no_file" });
    try {
      const extracted = await mayaScrapeFinancials({
        buffer: f.buffer,
        mime: f.mimetype,
        filename: f.originalname,
      });
      return res.json({
        extracted,
        confidence: extracted._confidence ?? null,
        source_filename: f.originalname,
      });
    } catch (err: any) {
      return res.status(502).json({ error: "scrape_failed", detail: String(err?.message) });
    }
  });

  return router;
}

export default createScrapeRouter();
