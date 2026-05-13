// BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
// BI-side Maya endpoint. Mirrors BF-Server v214's contract:
//   POST /api/v1/bi/maya/staff/pipeline-query
//   Auth: service JWT (kind=service, source=maya-service|agent)
//   Body: { question: string, session_id?: string, user_id?: string }
//   Response: { ok, query?, rows?, summary?, not_supported?, supported_queries? }
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { runBiPipelineQuery } from "../services/biMayaPipelineQuery";

const router = express.Router();

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}

function verifyMayaService(req: Request): { source: string } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; source?: string };
    if (p?.kind !== "service") return null;
    if (p.source !== "maya-service" && p.source !== "agent") return null;
    return { source: String(p.source) };
  } catch {
    return null;
  }
}

async function audit(opts: {
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
  errorCode?: string;
  source?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bi_maya_audit
         (id, audience, service_source, tool, args_redacted, result_summary, ok, error_code)
       VALUES ($1,'staff',$2,$3,$4::jsonb,$5,$6,$7)`,
      [
        randomUUID(),
        opts.source ?? null,
        opts.tool,
        JSON.stringify(opts.args ?? null),
        opts.summary.slice(0, 500),
        opts.ok,
        opts.errorCode ?? null,
      ],
    );
  } catch (e: any) {
    logger.error({ err: e, tool: opts.tool }, "bi_maya_audit_insert_failed");
  }
}

router.post("/maya/staff/pipeline-query", async (req: Request, res: Response) => {
  const svc = verifyMayaService(req);
  if (!svc) return res.status(401).json({ ok: false, error: "service_jwt_required" });
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  if (!question.trim()) {
    return res.status(400).json({ ok: false, error: "question_required" });
  }
  try {
    const result = await runBiPipelineQuery(question);
    await audit({
      tool: "pipeline.query",
      args: { question },
      ok: !!result.ok,
      summary: result.summary ?? "",
      source: svc.source,
    });
    return res.json(result);
  } catch (e: any) {
    await audit({
      tool: "pipeline.query",
      args: { question },
      ok: false,
      summary: e?.message ?? "error",
      errorCode: "bi_pipeline_query_exception",
      source: svc.source,
    });
    logger.error({ err: e }, "bi_maya_pipeline_query_failed");
    return res.status(500).json({ ok: false, error: "pipeline_query_failed" });
  }
});

export default router;
