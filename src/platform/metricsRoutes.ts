import crypto from "node:crypto";
import express from "express";
import { registry } from "./metrics";

const router = express.Router();

// BI_SERVER_v789_METRICS_AUTH - /metrics requires
// "Authorization: Bearer <METRICS_TOKEN>". With METRICS_TOKEN unset the
// endpoint does not exist (404), so nothing is exposed by default.
export function metricsAuthorized(header: string | undefined, token = process.env.METRICS_TOKEN): boolean {
  if (!token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(header ?? "").trim());
  if (!m) return false;
  const given = crypto.createHash("sha256").update(m[1]).digest();
  const expected = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(given, expected);
}

router.get("/metrics", async (req, res) => {
  if (!process.env.METRICS_TOKEN) return res.status(404).json({ error: "not_found" });
  if (!metricsAuthorized(req.header("authorization"))) return res.status(401).json({ error: "unauthorized" });
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

export default router;
